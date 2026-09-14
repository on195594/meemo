/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    childProcess = require('child_process'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    userMigrator = require('../../scripts/migrate-users-to-mongo.js'),
    preflight = require('../../scripts/preflight-legacy-retirement.js');

var THING_ID = new ObjectId('000000000000000000002041');

function createUserManifest(usersFile, mongoUrl, manifestFile) {
    fs.rmSync(manifestFile, { force: true });
    return new Promise(function (resolve, reject) {
        userMigrator.dryRun({
            usersFile: usersFile,
            mongoUrl: mongoUrl,
            manifestFile: manifestFile
        }, function (error, report) {
            if (error) return reject(error);
            resolve(report.manifest);
        });
    });
}

function seedRetirementState(db, prefix, manifest) {
    var ownerObjectId = new ObjectId(manifest.usernameToId.alice);
    var ownerId = String(ownerObjectId);
    var thing = {
        _id: THING_ID,
        content: 'Migrated note',
        createdAt: 100,
        modifiedAt: 200,
        attachments: [{ identifier: 'attachment-1' }],
        externalContent: [],
        public: true,
        shared: false,
        archived: false,
        sticky: true
    };
    var tag = { name: 'work', usage: 2, createdAt: 150 };
    var settings = { type: 'frontend', value: { title: 'Migrated' } };

    return Promise.all([
        db.collection(prefix + 'users').insertOne({
            _id: ownerObjectId,
            username: 'alice',
            usernameNorm: 'alice',
            displayName: 'alice',
            email: '',
            passwordHash: 'hash',
            status: 'active',
            createdAt: manifest.transformationTimestamp
        }),
        db.collection(prefix + 'alice_things').insertOne(thing),
        db.collection(prefix + 'alice_tags').insertOne(tag),
        db.collection(prefix + 'alice_settings').insertOne(settings),
        db.collection(prefix + 'things').insertOne(Object.assign({}, thing, { ownerId: ownerId })),
        db.collection(prefix + 'tags').insertOne(Object.assign({}, tag, {
            ownerId: ownerId,
            modifiedAt: 150
        })),
        db.collection(prefix + 'settings').insertOne(Object.assign({}, settings, {
            ownerId: ownerId,
            modifiedAt: 1000
        })),
        db.collection(prefix + 'system_migrations').insertOne({
            _id: 'schema-v2',
            sourceVersion: 1,
            targetVersion: 2,
            phase: 'complete',
            startedAt: 1000
        }),
        db.collection(prefix + 'system_migrations').insertOne({
            _id: 'users-file-to-mongo',
            stateVersion: 1,
            phase: 'applied',
            runId: manifest.runId,
            manifestDigest: manifest.manifestDigest,
            manifest: manifest,
            nextIndex: manifest.transformed.count,
            startedAt: manifest.transformationTimestamp,
            plannedAppliedAt: manifest.transformationTimestamp,
            appliedAt: manifest.transformationTimestamp
        })
    ]);
}

describe('Legacy retirement preflight (VR-204)', function () {
    this.timeout(20000);

    var client;
    var db;
    var usersFile;
    var usersManifestFile;

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        usersFile = path.join(os.tmpdir(), 'meemo-retirement-' + process.pid + '.json');
        usersManifestFile = usersFile + '.manifest.json';
    });

    beforeEach(async function () {
        var collections = await db.listCollections().toArray();
        await Promise.all(collections.map(function (entry) {
            if (/^vr204_/.test(entry.name)) return db.collection(entry.name).drop();
        }));
        fs.writeFileSync(usersFile, JSON.stringify({
            alice: { username: 'alice', passwordHash: 'hash' }
        }));
        var manifest = await createUserManifest(usersFile, config.databaseUrl, usersManifestFile);
        await seedRetirementState(db, 'vr204_', manifest);
    });

    after(async function () {
        try { fs.unlinkSync(usersFile); } catch (ignore) {}
        fs.rmSync(usersManifestFile, { force: true });
        await client.close();
    });

    function options(overrides) {
        return Object.assign({
            db: db,
            mongoUrl: config.databaseUrl,
            collectionPrefix: 'vr204_',
            usersFile: usersFile,
            usersFileBound: true,
            authUserSource: 'mongo',
            environment: 'test',
            expectedEnvironment: 'test',
            expectedDatabase: db.databaseName
        }, overrides || {});
    }

    it('returns safe only after proving every populated legacy document equivalent', async function () {
        var report = await preflight.run(options());

        expect(report.status).to.be('SAFE_TO_RETIRE');
        expect(report.safe).to.be(true);
        expect(report.checks.data.safe).to.be(true);
        expect(report.checks.data.sourceCount).to.be(3);
        expect(report.checks.data.matchedCount).to.be(3);
        expect(report.checks.data.sourceDigest).to.be(report.checks.data.targetDigest);
        expect(report.legacyCollections.map(function (entry) { return entry.name; }).sort()).to.eql([
            'vr204_alice_settings', 'vr204_alice_tags', 'vr204_alice_things'
        ]);
        expect(report.ownerMappings).to.have.length(1);
        expect(report.ownerMappings[0].prefix).to.be('alice');
    });

    [
        {
            name: 'missing unified thing',
            mutate: function (db) { return db.collection('vr204_things').deleteOne({ _id: THING_ID }); },
            entity: 'things', field: '_id'
        },
        {
            name: 'mismatched unified tag',
            mutate: function (db) {
                return db.collection('vr204_tags').updateOne({ name: 'work' }, { $set: { usage: 99 } });
            },
            entity: 'tags', field: 'usage'
        },
        {
            name: 'missing unified settings',
            mutate: function (db) { return db.collection('vr204_settings').deleteOne({}); },
            entity: 'settings', field: 'type'
        }
    ].forEach(function (testCase) {
        it('fails closed for a ' + testCase.name, async function () {
            await testCase.mutate(db);
            var report = await preflight.run(options());

            expect(report.safe).to.be(false);
            expect(report.checks.data.safe).to.be(false);
            expect(report.dataMismatches.some(function (mismatch) {
                return mismatch.entity === testCase.entity && mismatch.field === testCase.field;
            })).to.be(true);
        });
    });

    it('fails closed when the authoritative users source is empty or unbound', async function () {
        fs.writeFileSync(usersFile, '{}');
        var empty = await preflight.run(options());
        var unbound = await preflight.run(options({ usersFileBound: false }));

        expect(empty.safe).to.be(false);
        expect(empty.checks.usersFile.safe).to.be(false);
        expect(empty.checks.identities.sourceCount).to.be(0);
        expect(unbound.safe).to.be(false);
        expect(unbound.checks.usersFile.bound).to.be(false);
    });

    it('fails closed on identity count and digest mismatches', async function () {
        await db.collection('vr204_users').updateOne(
            { usernameNorm: 'alice' }, { $set: { passwordHash: 'wrong' } }
        );
        var digestMismatch = await preflight.run(options());
        expect(digestMismatch.checks.identities.sourceCount).to.be(1);
        expect(digestMismatch.checks.identities.mongoCount).to.be(1);
        expect(digestMismatch.checks.identities.sourceDigest).not.to.be(
            digestMismatch.checks.identities.mongoDigest
        );
        expect(digestMismatch.safe).to.be(false);

        await db.collection('vr204_users').insertOne({
            _id: new ObjectId(), username: 'bob', usernameNorm: 'bob', displayName: 'bob',
            email: '', passwordHash: 'hash', status: 'active'
        });
        var countMismatch = await preflight.run(options());
        expect(countMismatch.checks.identities.mongoCount).to.be(2);
        expect(countMismatch.safe).to.be(false);
    });

    [
        {
            name: 'missing',
            mutate: function () {
                return db.collection('vr204_system_migrations')
                    .deleteOne({ _id: 'users-file-to-mongo' });
            }
        },
        {
            name: 'tampered',
            mutate: function () {
                return db.collection('vr204_system_migrations').updateOne(
                    { _id: 'users-file-to-mongo' },
                    { $set: { 'manifest.source.count': 2 } }
                );
            }
        }
    ].forEach(function (testCase) {
        it('fails closed for ' + testCase.name + ' finalized user migration evidence', async function () {
            await testCase.mutate();
            var report = await preflight.run(options());

            expect(report.safe).to.be(false);
            expect(report.checks.usersMigration.safe).to.be(false);
            expect(JSON.stringify(report)).not.to.contain('hash');
            expect(JSON.stringify(report)).not.to.contain(config.databaseUrl);
        });
    });

    [
        {
            name: 'createdAt',
            mutate: function () {
                return db.collection('vr204_users').updateOne(
                    { usernameNorm: 'alice' }, { $inc: { createdAt: 1 } }
                );
            }
        },
        {
            name: 'username-to-id mapping',
            mutate: async function () {
                var user = await db.collection('vr204_users').findOne({ usernameNorm: 'alice' });
                await db.collection('vr204_users').deleteOne({ _id: user._id });
                user._id = new ObjectId('000000000000000000002042');
                await db.collection('vr204_users').insertOne(user);
            }
        }
    ].forEach(function (testCase) {
        it('fails closed on migrated user ' + testCase.name + ' divergence', async function () {
            await testCase.mutate();
            var report = await preflight.run(options());

            expect(report.safe).to.be(false);
            expect(report.checks.usersMigration.safe).to.be(false);
        });
    });

    it('accepts valid manifests when source-key and normalized-username order differ', async function () {
        fs.writeFileSync(usersFile, JSON.stringify({
            Zed: { username: 'zed', passwordHash: 'zed-hash' },
            alice: { username: 'alice', passwordHash: 'hash' }
        }));
        var collections = await db.listCollections().toArray();
        await Promise.all(collections.map(function (entry) {
            if (/^vr204_/.test(entry.name)) return db.collection(entry.name).drop();
        }));
        var manifest = await createUserManifest(usersFile, config.databaseUrl, usersManifestFile);
        await seedRetirementState(db, 'vr204_', manifest);
        await db.collection('vr204_users').insertOne({
            _id: new ObjectId(manifest.usernameToId.zed),
            username: 'zed', usernameNorm: 'zed', displayName: 'zed', email: '',
            passwordHash: 'zed-hash', status: 'active',
            createdAt: manifest.transformationTimestamp
        });

        var report = await preflight.run(options());
        expect(report.checks.usersMigration.safe).to.be(true);
        expect(report.safe).to.be(true);
    });

    it('accepts valid UTF-8, mixed-case, symlink-bound user migration evidence', async function () {
        var linkedUsersFile = usersFile + '.link';
        fs.writeFileSync(usersFile, JSON.stringify({
            Alice: { username: 'Alice', displayName: '爱丽丝', passwordHash: 'hash' }
        }));
        fs.rmSync(linkedUsersFile, { force: true });
        fs.symlinkSync(usersFile, linkedUsersFile);
        try {
            var collections = await db.listCollections().toArray();
            await Promise.all(collections.map(function (entry) {
                if (/^vr204_/.test(entry.name)) return db.collection(entry.name).drop();
            }));
            var manifest = await createUserManifest(
                linkedUsersFile, config.databaseUrl, usersManifestFile
            );
            await seedRetirementState(db, 'vr204_', manifest);
            await db.collection('vr204_users').updateOne(
                { usernameNorm: 'alice' },
                { $set: { username: 'Alice', displayName: '爱丽丝' } }
            );

            var report = await preflight.run(options({ usersFile: linkedUsersFile }));
            expect(report.checks.usersMigration.safe).to.be(true);
            expect(report.safe).to.be(true);
        } finally {
            fs.rmSync(linkedUsersFile, { force: true });
        }
    });

    it('fails closed when the authoritative users source does not bind a legacy owner', async function () {
        fs.writeFileSync(usersFile, JSON.stringify({
            bob: { username: 'bob', passwordHash: 'hash' }
        }));
        await db.collection('vr204_users').insertOne({
            _id: new ObjectId(), username: 'bob', usernameNorm: 'bob', displayName: 'bob',
            email: '', passwordHash: 'hash', status: 'active'
        });

        var report = await preflight.run(options());
        expect(report.safe).to.be(false);
        expect(report.unmatchedOwners).to.contain('alice');
    });

    it('reports unsafe identity, owner, migration, auth, and binding conditions together', async function () {
        fs.writeFileSync(usersFile, JSON.stringify({
            Alice: { username: 'alice', passwordHash: 'one' },
            alice: { username: 'ALICE', passwordHash: 'two' },
            missing: { username: 'missing', passwordHash: 'three' }
        }));
        await db.createCollection('vr204_orphan_things');
        await db.collection('vr204_system_migrations').updateOne(
            { _id: 'schema-v2' }, { $set: { phase: 'verified' } }
        );

        var report = await preflight.run(options({
            authUserSource: 'fallback',
            expectedEnvironment: null,
            expectedDatabase: 'wrong-database'
        }));

        expect(report.status).to.be('UNSAFE_TO_RETIRE');
        expect(report.safe).to.be(false);
        expect(report.checks.authUserSource.safe).to.be(false);
        expect(report.checks.environment.bound).to.be(false);
        expect(report.checks.database.safe).to.be(false);
        expect(report.checks.migration.safe).to.be(false);
        expect(report.identityCollisions.length).to.be.greaterThan(0);
        expect(report.unmatchedFileUsers).to.contain('missing');
        expect(report.unmatchedOwners).to.contain('orphan');
    });

    [
        {
            entity: 'things', identityField: '_id',
            add: function (ownerId, modifiedAt) {
                return db.collection('vr204_things').insertOne({
                    _id: new ObjectId('000000000000000000002043'), ownerId: ownerId,
                    content: 'destination only', createdAt: modifiedAt, modifiedAt: modifiedAt,
                    attachments: [], externalContent: [], public: false, shared: false,
                    archived: false, sticky: false
                });
            },
            edit: function (modifiedAt) {
                return db.collection('vr204_things').updateOne(
                    { _id: THING_ID }, { $set: { content: 'destination edit', modifiedAt: modifiedAt } }
                );
            }
        },
        {
            entity: 'tags', identityField: 'name',
            add: function (ownerId, modifiedAt) {
                return db.collection('vr204_tags').insertOne({
                    ownerId: ownerId, name: 'destination-only', usage: 1,
                    createdAt: modifiedAt, modifiedAt: modifiedAt
                });
            },
            edit: function (modifiedAt) {
                return db.collection('vr204_tags').updateOne(
                    { name: 'work' }, { $set: { usage: 99, modifiedAt: modifiedAt } }
                );
            }
        },
        {
            entity: 'settings', identityField: 'type',
            add: function (ownerId, modifiedAt) {
                return db.collection('vr204_settings').insertOne({
                    ownerId: ownerId, type: 'destination-only',
                    value: { title: 'Destination only' }, modifiedAt: modifiedAt
                });
            },
            edit: function (modifiedAt) {
                return db.collection('vr204_settings').updateOne(
                    { type: 'frontend' },
                    { $set: { value: { title: 'Destination edit' }, modifiedAt: modifiedAt } }
                );
            }
        }
    ].forEach(function (testCase) {
        it('rejects an unmatched destination ' + testCase.entity + ' record at the migration boundary', async function () {
            var user = await db.collection('vr204_users').findOne({ usernameNorm: 'alice' });
            await testCase.add(String(user._id), 1000);
            var report = await preflight.run(options());

            expect(report.safe).to.be(false);
            expect(report.checks.data.safe).to.be(false);
            expect(report.dataMismatches.some(function (mismatch) {
                return mismatch.entity === testCase.entity && mismatch.field === testCase.identityField;
            })).to.be(true);
        });

        it('excludes post-boundary destination ' + testCase.entity + ' additions and edits symmetrically', async function () {
            var user = await db.collection('vr204_users').findOne({ usernameNorm: 'alice' });
            await Promise.all([
                testCase.add(String(user._id), 1001),
                testCase.edit(1001)
            ]);
            var report = await preflight.run(options());

            expect(report.safe).to.be(true);
            expect(report.checks.data.safe).to.be(true);
            expect(report.checks.data.sourceCount).to.be(2);
            expect(report.checks.data.matchedCount).to.be(2);
            expect(report.checks.data.sourceDigest).to.be(report.checks.data.targetDigest);
        });
    });

    [
        {
            entity: 'things',
            add: function (ownerId) {
                return db.collection('vr204_things').insertOne({
                    _id: new ObjectId('000000000000000000002044'), ownerId: ownerId,
                    content: 'unmatched', createdAt: 1000, modifiedAt: 1000,
                    attachments: [], externalContent: [], public: false, shared: false,
                    archived: false, sticky: false
                });
            }
        },
        {
            entity: 'tags',
            add: function (ownerId) {
                return db.collection('vr204_tags').insertOne({
                    ownerId: ownerId, name: 'unmatched', usage: 1,
                    createdAt: 1000, modifiedAt: 1000
                });
            }
        },
        {
            entity: 'settings',
            add: function (ownerId) {
                return db.collection('vr204_settings').insertOne({
                    ownerId: ownerId, type: 'unmatched', value: {}, modifiedAt: 1000
                });
            }
        }
    ].forEach(function (testCase) {
        it('rejects boundary ' + testCase.entity + ' when no legacy entity collection exists', async function () {
            var user = await db.collection('vr204_users').findOne({ usernameNorm: 'alice' });
            await db.collection('vr204_alice_' + testCase.entity).drop();
            await db.collection('vr204_' + testCase.entity).deleteMany({});
            await testCase.add(String(user._id));

            var report = await preflight.run(options());
            expect(report.safe).to.be(false);
            expect(report.dataMismatches.some(function (mismatch) {
                return mismatch.entity === testCase.entity;
            })).to.be(true);
        });
    });

    it('redacts malformed MongoDB connection strings from CLI errors', function () {
        var marker = 'do-not-echo-this';
        var result = childProcess.spawnSync(process.execPath, [
            path.resolve(__dirname, '../../scripts/preflight-legacy-retirement.js'),
            '--mongo-url', 'mongodb://' + marker + ':password@[/database',
            '--users-file', usersFile,
            '--expect-environment', 'test',
            '--expect-database', 'database'
        ], { encoding: 'utf8', timeout: 10000 });

        expect(result.status).to.be(1);
        expect(result.stdout).to.contain('SAFE_TO_RETIRE=false');
        expect(result.stderr).not.to.contain(marker);
        expect(result.stderr).not.to.contain('password');
    });

    it('prints the boolean CLI contract and exits 0 safe / 1 unsafe', async function () {
        var cliDatabaseName = 'vr204_cli_' + process.pid;
        var cliDb = client.db(cliDatabaseName);
        var cliMongoUrl = config.databaseUrl.replace(/\/[^/?]+(\?.*)?$/, '/' + cliDatabaseName + '$1');
        var cliManifestFile = usersManifestFile + '.cli';
        await cliDb.dropDatabase();
        var cliManifest = await createUserManifest(usersFile, cliMongoUrl, cliManifestFile);
        await seedRetirementState(cliDb, '', cliManifest);

        var args = [
            path.resolve(__dirname, '../../scripts/preflight-legacy-retirement.js'),
            '--mongo-url', cliMongoUrl,
            '--users-file', usersFile,
            '--expect-environment', 'test',
            '--expect-database', cliDatabaseName
        ];
        var environment = Object.assign({}, process.env, {
            AUTH_USER_SOURCE: 'mongo', DEPLOYMENT_ENV: 'test'
        });
        var safe = childProcess.spawnSync(process.execPath, args, {
            encoding: 'utf8', env: environment, timeout: 10000
        });
        expect(safe.status).to.be(0);
        expect(safe.stdout).to.contain('SAFE_TO_RETIRE=true');

        await cliDb.collection('things').deleteOne({ _id: THING_ID });
        var unsafe = childProcess.spawnSync(process.execPath, args, {
            encoding: 'utf8', env: environment, timeout: 10000
        });
        expect(unsafe.status).to.be(1);
        expect(unsafe.stdout).to.contain('SAFE_TO_RETIRE=false');
        await cliDb.dropDatabase();
        fs.rmSync(cliManifestFile, { force: true });
    });

    it('uses only filesystem and MongoDB read operations', async function () {
        var writes = 0;
        var readOnlyDb = {
            databaseName: db.databaseName,
            listCollections: function () { return db.listCollections(); },
            collection: function (name) {
                var collection = db.collection(name);
                return {
                    find: function (query) { return collection.find(query); },
                    findOne: function (query) { return collection.findOne(query); },
                    countDocuments: function (query) { return collection.countDocuments(query); },
                    insertOne: function () { writes++; throw new Error('write attempted'); },
                    updateOne: function () { writes++; throw new Error('write attempted'); },
                    replaceOne: function () { writes++; throw new Error('write attempted'); },
                    deleteOne: function () { writes++; throw new Error('write attempted'); },
                    createIndex: function () { writes++; throw new Error('write attempted'); }
                };
            }
        };

        var report = await preflight.run(options({ db: readOnlyDb }));
        expect(report.status).to.be('SAFE_TO_RETIRE');
        expect(writes).to.be(0);
    });
});
