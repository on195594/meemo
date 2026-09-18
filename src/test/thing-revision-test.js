'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var config = require('../config.js');
var things = require('../database/things.js');
var migration = require('../../scripts/migrate-thing-revisions.js');

describe('Thing revision CAS and migration (M1)', function () {
    var client;
    var db;
    var owner = 'revision-test-owner';

    before(async function () {
        await config._clearDatabase();
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        config.db = db;
        things.resetCache();
    });

    after(async function () {
        await config._clearDatabase();
        await client.close();
    });

    it('allows exactly one concurrent update for the same expected revision', async function () {
        var created = await things.insertFull(owner, 'initial', [], [], [], 1, 1);
        var results = await Promise.allSettled([
            things.put(owner, created._id, 'first', [], [], [], false, false, false, false, undefined, created.revision),
            things.put(owner, created._id, 'second', [], [], [], false, false, false, false, undefined, created.revision)
        ]);
        expect(results.filter(function (result) { return result.status === 'fulfilled'; }).length).to.equal(1);
        expect(results.filter(function (result) {
            return result.status === 'rejected' && result.reason.code === 'revision_conflict';
        }).length).to.equal(1);
        var current = await things.get(owner, created._id);
        expect(current.revision).to.equal(2);
        await things.del(owner, created._id, current.revision);
    });

    it('backfills only missing revisions and is safe to rerun', async function () {
        var oldId = new ObjectId();
        var currentId = new ObjectId();
        await db.collection('things').insertMany([
            { _id: oldId, ownerId: owner, content: 'old' },
            { _id: currentId, ownerId: owner, content: 'current', revision: 7 }
        ]);

        var options = migration.parseArgs([
            '--dry-run', '--mongo-url', config.databaseUrl, '--expect-database', db.databaseName
        ]);
        var dryRun = await migration.run(options);
        expect(dryRun.before.missing).to.equal(1);
        expect(dryRun.after.missing).to.equal(1);
        expect((await db.collection('things').findOne({ _id: oldId })).revision).to.be(undefined);

        options = migration.parseArgs([
            '--apply', '--mongo-url', config.databaseUrl, '--expect-database', db.databaseName
        ]);
        var applied = await migration.run(options);
        expect(applied.after.missing).to.equal(0);
        expect((await db.collection('things').findOne({ _id: oldId })).revision).to.equal(1);

        var rerun = await migration.run(options);
        expect(rerun.before.missing).to.equal(0);
        expect((await db.collection('things').findOne({ _id: currentId })).revision).to.equal(7);
    });

    it('rejects invalid revisions and mismatched database targets', async function () {
        var invalidId = new ObjectId();
        await db.collection('things').insertOne({
            _id: invalidId, ownerId: owner, content: 'invalid', revision: 0
        });
        var options = migration.parseArgs([
            '--apply', '--mongo-url', config.databaseUrl, '--expect-database', db.databaseName
        ]);
        var error;
        try {
            await migration.run(options);
        } catch (runError) {
            error = runError;
        }
        expect(error).to.be.ok();
        expect(error.message).to.contain('Invalid Thing revisions');
        expect(function () {
            migration.parseArgs([
                '--dry-run', '--mongo-url', config.databaseUrl, '--expect-database', 'wrong-db'
            ]);
        }).to.throwError(/does not match/);
    });
});
