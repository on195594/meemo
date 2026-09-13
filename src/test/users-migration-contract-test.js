'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var assert = require('assert'),
    expect = require('expect.js'),
    fs = require('fs'),
    MongoClient = require('mongodb').MongoClient,
    config = require('../config.js'),
    migrator = require('../../scripts/migrate-users-to-mongo.js');

describe('User migration cutover contract', function () {
    var client;
    var db;
    var fixturePrefix = '/tmp/meemo-user-migration-contract-' + process.pid;
    var usersFile = fixturePrefix + '.json';
    var manifestFile = fixturePrefix + '.manifest.json';
    var sourceUsers;

    function call(method, options) {
        return new Promise(function (resolve, reject) {
            migrator[method](options, function (error, result) {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }

    async function inspectedOptions(outputManifest) {
        outputManifest = outputManifest || manifestFile;
        fs.rmSync(outputManifest, { force: true });
        await call('dryRun', {
            usersFile: usersFile,
            mongoUrl: config.databaseUrl,
            manifestFile: outputManifest
        });
        return {
            usersFile: usersFile,
            mongoUrl: config.databaseUrl,
            manifestFile: outputManifest
        };
    }

    async function captureError(method, options) {
        try {
            await call(method, options);
        } catch (error) {
            return error;
        }
        throw new Error('Expected ' + method + ' to fail');
    }

    async function resetCollections() {
        await db.collection('users').drop().catch(function (error) {
            if (error.codeName !== 'NamespaceNotFound') throw error;
        });
        await db.collection('system_migrations').deleteOne({ _id: 'users-file-to-mongo' });
    }

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
    });

    after(async function () {
        fs.rmSync(usersFile, { force: true });
        fs.rmSync(manifestFile, { force: true });
        fs.rmSync(fixturePrefix + '.second-manifest.json', { force: true });
        fs.rmSync(fixturePrefix + '.copy.json', { force: true });
        if (db) await resetCollections();
        if (client) await client.close();
    });

    beforeEach(async function () {
        sourceUsers = {
            alice: {
                username: 'Alice',
                displayName: 'Alice Example',
                email: 'alice@example.invalid',
                passwordHash: 'alice-hash',
                createdAt: 123456789
            },
            bob: {
                username: 'bob',
                passwordHash: 'bob-hash'
            }
        };
        fs.writeFileSync(usersFile, JSON.stringify(sourceUsers, null, 4));
        fs.rmSync(manifestFile, { force: true });
        await resetCollections();
    });

    it('requires explicit identities and one reviewed manifest artifact', function () {
        expect(function () {
            migrator.parseArgs(['--dry-run', '--mongo-url', config.databaseUrl, '--manifest', manifestFile]);
        }).to.throwError(/--users-file/);
        expect(function () {
            migrator.parseArgs([
                '--dry-run', '--users-file', usersFile,
                '--mongo-url', config.databaseUrl, '--unknown'
            ]);
        }).to.throwError(/Unknown argument/);
        expect(function () {
            migrator.parseArgs([
                '--apply', '--users-file', usersFile,
                '--mongo-url', config.databaseUrl
            ]);
        }).to.throwError(/--manifest/);
    });

    it('emits a complete secret-free immutable manifest used by apply and verify', async function () {
        var options = await inspectedOptions();
        var manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        var serialized = JSON.stringify(manifest);

        expect(manifest.version).to.equal(1);
        expect(manifest.migration).to.equal('users-file-to-mongo');
        expect(manifest.runId).to.match(/^[0-9a-f-]{36}$/);
        expect(manifest.manifestDigest).to.match(/^[a-f0-9]{64}$/);
        expect(manifest.source.identity).to.equal(fs.realpathSync(usersFile));
        expect(manifest.source.byteCount).to.equal(fs.statSync(usersFile).size);
        expect(manifest.source.byteDigest).to.match(/^[a-f0-9]{64}$/);
        expect(manifest.source.canonicalDigest).to.match(/^[a-f0-9]{64}$/);
        expect(manifest.source.count).to.equal(2);
        expect(manifest.transformationTimestamp).to.be.a('number');
        expect(manifest.target.database).to.equal(db.databaseName);
        expect(manifest.target.hosts).to.be.an(Array);
        expect(manifest.transformed.count).to.equal(2);
        expect(manifest.transformed.digest).to.match(/^[a-f0-9]{64}$/);
        expect(manifest.usernameToId.alice).to.match(/^[a-f0-9]{24}$/);
        expect(manifest.usernameToId.bob).to.match(/^[a-f0-9]{24}$/);
        expect(serialized).not.to.contain('alice-hash');
        expect(serialized).not.to.contain('bob-hash');
        expect(serialized).not.to.contain(config.databaseUrl);
        expect(serialized).not.to.contain('AUTH_USER_SOURCE');
        expect(function () {
            fs.writeFileSync(manifestFile, '{}', { flag: 'wx' });
        }).to.throwError();

        await call('apply', options);
        await call('verify', options);
        var bob = await db.collection('users').findOne({ usernameNorm: 'bob' });
        expect(String(bob._id)).to.equal(manifest.usernameToId.bob);
        expect(bob.createdAt).to.equal(manifest.transformationTimestamp);
    });

    it('resumes deterministically after a user write before progress evidence', async function () {
        var options = await inspectedOptions();
        var injected = false;
        options.failureInjector = function (point, details) {
            if (!injected && point === 'after-user-write' && details.index === 0) {
                injected = true;
                throw new Error('injected mid-loop failure');
            }
        };

        var failure = await captureError('apply', options);
        expect(failure.message).to.contain('injected mid-loop failure');
        var evidence = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        expect(evidence.phase).to.equal('applying');
        expect(evidence.nextIndex).to.equal(0);
        expect(await db.collection('users').countDocuments({})).to.equal(1);
        var first = await db.collection('users').findOne({});

        delete options.failureInjector;
        var result = await call('apply', options);
        expect(result.resumed).to.equal(true);
        expect(await db.collection('users').countDocuments({})).to.equal(2);
        expect(String((await db.collection('users').findOne({ usernameNorm: first.usernameNorm }))._id))
            .to.equal(String(first._id));
        expect((await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' })).phase)
            .to.equal('applied');
    });

    it('restarts deterministically when evidence finalization fails', async function () {
        var options = await inspectedOptions();
        var injected = false;
        options.failureInjector = function (point) {
            if (!injected && point === 'before-evidence-finalize') {
                injected = true;
                throw new Error('injected finalization failure');
            }
        };

        var failure = await captureError('apply', options);
        expect(failure.message).to.contain('injected finalization failure');
        var applying = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        var ids = (await db.collection('users').find({}).sort({ usernameNorm: 1 }).toArray())
            .map(function (record) { return String(record._id); });
        expect(applying.phase).to.equal('applying');
        expect(applying.nextIndex).to.equal(2);

        delete options.failureInjector;
        await call('apply', options);
        var applied = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        expect(applied.phase).to.equal('applied');
        expect(applied.appliedAt).to.equal(applying.plannedAppliedAt);
        assert.deepStrictEqual(
            (await db.collection('users').find({}).sort({ usernameNorm: 1 }).toArray())
                .map(function (record) { return String(record._id); }),
            ids
        );
    });

    it('makes a completed replay a verified no-write result with unchanged evidence', async function () {
        var options = await inspectedOptions();
        await call('apply', options);
        var before = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        var writes = [];
        var originalConnect = MongoClient.connect;
        MongoClient.connect = function (url, connectOptions) {
            var monitored = Object.assign({}, connectOptions || {}, { monitorCommands: true });
            return originalConnect.call(MongoClient, url, monitored).then(function (monitoredClient) {
                monitoredClient.on('commandStarted', function (event) {
                    if (['insert', 'update', 'delete', 'createIndexes', 'dropIndexes'].indexOf(event.commandName) !== -1) {
                        writes.push(event.commandName);
                    }
                });
                return monitoredClient;
            });
        };

        var replay;
        try {
            replay = await call('apply', options);
        } finally {
            MongoClient.connect = originalConnect;
        }
        var after = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        expect(replay.migrated).to.equal(0);
        expect(replay.skipped).to.equal(2);
        expect(replay.replayed).to.equal(true);
        assert.deepStrictEqual(writes, []);
        expect(after.appliedAt).to.equal(before.appliedAt);
        expect(after.plannedAppliedAt).to.equal(before.plannedAppliedAt);
    });

    it('fails a resumed or completed run on target divergence without rewriting it', async function () {
        var options = await inspectedOptions();
        await call('apply', options);
        var evidenceBefore = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        await db.collection('users').updateOne({ usernameNorm: 'alice' }, { $set: { displayName: 'diverged' } });

        var failure = await captureError('apply', options);
        expect(failure.message).to.contain('Target divergence');
        expect((await db.collection('users').findOne({ usernameNorm: 'alice' })).displayName)
            .to.equal('diverged');
        expect((await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' })).appliedAt)
            .to.equal(evidenceBefore.appliedAt);
    });

    it('rejects manifest tampering and source identity mismatch before mutation', async function () {
        var options = await inspectedOptions();
        var manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        manifest.runId = '00000000-0000-4000-8000-000000000000';
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
        var tamperError = await captureError('apply', options);
        expect(tamperError.message).to.contain('manifest digest');
        expect(await db.collection('users').countDocuments({})).to.equal(0);
        expect(await db.collection('system_migrations').countDocuments({})).to.equal(0);

        options = await inspectedOptions();
        var copiedSource = fixturePrefix + '.copy.json';
        fs.copyFileSync(usersFile, copiedSource);
        options.usersFile = copiedSource;
        var identityError = await captureError('apply', options);
        expect(identityError.message).to.contain('source identity');
        expect(await db.collection('users').countDocuments({})).to.equal(0);
        expect(await db.collection('system_migrations').countDocuments({})).to.equal(0);

        options = await inspectedOptions();
        var otherTarget = new URL(config.databaseUrl);
        otherTarget.pathname = '/meemo-other-' + process.pid;
        options.mongoUrl = otherTarget.toString();
        var targetIdentityError = await captureError('apply', options);
        expect(targetIdentityError.message).to.contain('target database identity');
        expect(await db.collection('users').countDocuments({})).to.equal(0);
        expect(await db.collection('system_migrations').countDocuments({})).to.equal(0);
    });

    it('fails a divergent reviewed run instead of adopting its generated ids', async function () {
        var first = await inspectedOptions();
        await call('apply', first);
        var evidenceBefore = await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' });
        var idsBefore = (await db.collection('users').find({}).sort({ usernameNorm: 1 }).toArray())
            .map(function (record) { return String(record._id); });
        var divergent = await inspectedOptions(fixturePrefix + '.second-manifest.json');

        var failure = await captureError('apply', divergent);
        expect(failure.message).to.match(/Target divergence|divergent manifest run/);
        assert.deepStrictEqual(
            (await db.collection('users').find({}).sort({ usernameNorm: 1 }).toArray())
                .map(function (record) { return String(record._id); }),
            idsBefore
        );
        expect((await db.collection('system_migrations').findOne({ _id: 'users-file-to-mongo' })).runId)
            .to.equal(evidenceBefore.runId);
    });

    it('fails on a conflicting usernameNorm index with zero user or evidence mutation', async function () {
        var options = await inspectedOptions();
        await db.collection('users').createIndex({ usernameNorm: 1 }, { unique: false });

        var failure = await captureError('apply', options);
        expect(failure.message).to.contain('exact unique usernameNorm index');
        expect(await db.collection('users').countDocuments({})).to.equal(0);
        expect(await db.collection('system_migrations').countDocuments({})).to.equal(0);
        var indexes = await db.collection('users').indexes();
        expect(indexes.filter(function (index) { return index.key.usernameNorm === 1; })[0].unique)
            .not.to.equal(true);
    });

    it('verifies canonical transformed fields and rejects unexpected target users', async function () {
        var options = await inspectedOptions();
        await call('apply', options);
        await call('verify', options);
        await db.collection('users').insertOne({
            username: 'outsider',
            usernameNorm: 'outsider',
            displayName: 'Outsider',
            email: '',
            passwordHash: 'hash',
            status: 'active',
            createdAt: Date.now()
        });
        var targetError = await captureError('verify', options);
        expect(targetError.message).to.contain('Unexpected target user outsider');
    });

    it('binds verify to finalized evidence for the exact manifest', async function () {
        var options = await inspectedOptions();
        await call('apply', options);
        await db.collection('system_migrations').updateOne(
            { _id: 'users-file-to-mongo' }, { $set: { phase: 'applying' } }
        );
        var evidenceError = await captureError('verify', options);
        expect(evidenceError.message).to.contain('finalized apply evidence');
    });
});
