/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    preflight = require('../../scripts/preflight-legacy-retirement.js');

describe('Legacy retirement preflight (VR-204)', function () {
    var client;
    var db;
    var usersFile;

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        usersFile = path.join(os.tmpdir(), 'meemo-retirement-' + process.pid + '.json');
    });

    beforeEach(async function () {
        var collections = await db.listCollections().toArray();
        await Promise.all(collections.map(function (entry) {
            if (/^vr204_/.test(entry.name)) return db.collection(entry.name).drop();
        }));
        fs.writeFileSync(usersFile, JSON.stringify({
            alice: { username: 'alice', passwordHash: 'hash' }
        }));
        await db.collection('vr204_users').insertOne({
            _id: new ObjectId(), username: 'alice', usernameNorm: 'alice', passwordHash: 'hash'
        });
        await db.createCollection('vr204_alice_things');
        await db.createCollection('vr204_alice_tags');
        await db.createCollection('vr204_alice_settings');
        await db.collection('vr204_system_migrations').insertOne({
            _id: 'schema-v2', sourceVersion: 1, targetVersion: 2, phase: 'complete'
        });
    });

    after(async function () {
        try { fs.unlinkSync(usersFile); } catch (ignore) {}
        await client.close();
    });

    function options(overrides) {
        return Object.assign({
            db: db,
            collectionPrefix: 'vr204_',
            usersFile: usersFile,
            usersFileBound: true,
            authUserSource: 'mongo',
            environment: 'test',
            expectedEnvironment: 'test',
            expectedDatabase: db.databaseName
        }, overrides || {});
    }

    it('returns SAFE_TO_RETIRE only when every retirement condition is bound and safe', async function () {
        var report = await preflight.run(options());

        expect(report.status).to.be('SAFE_TO_RETIRE');
        expect(report.safe).to.be(true);
        expect(report.legacyCollections.map(function (entry) { return entry.name; }).sort()).to.eql([
            'vr204_alice_settings', 'vr204_alice_tags', 'vr204_alice_things'
        ]);
        expect(report.ownerMappings).to.have.length(1);
        expect(report.ownerMappings[0].prefix).to.be('alice');
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
