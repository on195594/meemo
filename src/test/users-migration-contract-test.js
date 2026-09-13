'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var expect = require('expect.js'),
    fs = require('fs'),
    MongoClient = require('mongodb').MongoClient,
    config = require('../config.js'),
    migrator = require('../../scripts/migrate-users-to-mongo.js');

describe('User migration cutover contract', function () {
    var client;
    var db;
    var usersFile = '/tmp/meemo-user-migration-contract-' + process.pid + '.json';
    var sourceUsers;

    function call(method, options) {
        return new Promise(function (resolve, reject) {
            migrator[method](options, function (error, result) {
                if (error) return reject(error);
                resolve(result);
            });
        });
    }

    async function inspectedOptions() {
        var report = await call('dryRun', {
            usersFile: usersFile,
            mongoUrl: config.databaseUrl
        });
        return {
            usersFile: usersFile,
            mongoUrl: config.databaseUrl,
            expectedSourceCount: report.manifest.count,
            expectedSourceDigest: report.manifest.digest
        };
    }

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
    });

    after(async function () {
        fs.rmSync(usersFile, { force: true });
        if (db) {
            await db.collection('users').deleteMany({});
            await db.collection('system_migrations').deleteOne({ _id: 'users-file-to-mongo' });
        }
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
        await db.collection('users').deleteMany({});
        await db.collection('system_migrations').deleteOne({ _id: 'users-file-to-mongo' });
    });

    it('rejects implicit identities, unknown arguments, and missing expectations', function () {
        expect(function () {
            migrator.parseArgs(['--dry-run', '--mongo-url', config.databaseUrl]);
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
        }).to.throwError(/--expected-source-count/);
    });

    it('rejects missing and unexpectedly empty source files', async function () {
        var missingError;
        var emptyError;
        try {
            await call('dryRun', {
                usersFile: usersFile + '.missing',
                mongoUrl: config.databaseUrl
            });
        } catch (error) {
            missingError = error;
        }
        expect(missingError).to.be.ok();
        expect(missingError.message).to.contain('Failed to read users file');

        fs.writeFileSync(usersFile, '{}');
        try {
            await call('dryRun', {
                usersFile: usersFile,
                mongoUrl: config.databaseUrl
            });
        } catch (error) {
            emptyError = error;
        }
        expect(emptyError).to.be.ok();
        expect(emptyError.message).to.contain('zero users');
    });

    it('requires the exact inspected source count and digest before apply', async function () {
        var options = await inspectedOptions();
        options.expectedSourceCount++;
        var countError;
        try {
            await call('apply', options);
        } catch (error) {
            countError = error;
        }
        expect(countError).to.be.ok();
        expect(countError.message).to.contain('source count');
        expect(await db.collection('users').countDocuments({})).to.equal(0);

        options = await inspectedOptions();
        options.expectedSourceDigest = '0'.repeat(64);
        var digestError;
        try {
            await call('apply', options);
        } catch (error) {
            digestError = error;
        }
        expect(digestError).to.be.ok();
        expect(digestError.message).to.contain('source digest');
        expect(await db.collection('users').countDocuments({})).to.equal(0);
    });

    it('verifies canonical transformed fields and rejects unexpected target users', async function () {
        var options = await inspectedOptions();
        await call('apply', options);

        var alice = await db.collection('users').findOne({ usernameNorm: 'alice' });
        var bob = await db.collection('users').findOne({ usernameNorm: 'bob' });
        expect(alice.createdAt).to.equal(123456789);
        expect(alice.status).to.equal('active');
        expect(bob.displayName).to.equal('bob');
        expect(bob.email).to.equal('');
        expect(bob.status).to.equal('active');
        expect(typeof bob.createdAt).to.equal('number');
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
        var targetError;
        try {
            await call('verify', options);
        } catch (error) {
            targetError = error;
        }
        expect(targetError).to.be.ok();
        expect(targetError.message).to.contain('Unexpected target user outsider');
    });

    it('binds verify to matching apply evidence', async function () {
        var options = await inspectedOptions();
        await call('apply', options);
        await db.collection('system_migrations').deleteOne({ _id: 'users-file-to-mongo' });

        var evidenceError;
        try {
            await call('verify', options);
        } catch (error) {
            evidenceError = error;
        }
        expect(evidenceError).to.be.ok();
        expect(evidenceError.message).to.contain('apply evidence');
    });
});
