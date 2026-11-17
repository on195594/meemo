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
    var previousDb;
    var db;
    var owner = 'revision-test-owner';

    before(async function () {
        previousDb = config.db;
        await config._clearDatabase();
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        config.db = db;
        things.resetCache();
    });

    after(async function () {
        try {
            await config._clearDatabase();
            await client.close();
        } finally {
            config.db = previousDb;
        }
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
        await things.purge(owner, created._id, current.revision + 1);
    });

    it('moves deleted notes out of active reads and restores them with a new revision', async function () {
        var created = await things.insertFull(owner, '#trash-me', ['trash-me'], [], [], 1, 1);
        var deleted = await things.put(owner, created._id, '#trash-me', ['trash-me'], [], [], true, true, false, false, undefined, created.revision);
        await things.del(owner, created._id, deleted.revision);

        expect(await things.getAll(owner, {}, 0, 10)).to.have.length(0);
        var trash = await things.getAll(owner, { deletedAt: { $exists: true } }, 0, 10);
        expect(trash).to.have.length(1);
        expect(trash[0].public).to.be(false);
        expect(await things.getTagUsage(owner)).to.eql([]);

        var restored = await things.restore(owner, created._id, trash[0].revision);
        expect(restored.revision).to.equal(trash[0].revision + 1);
        expect(restored.deletedAt).to.be(undefined);
        expect(restored.public).to.be(false);
        expect((await things.getAll(owner, {}, 0, 10)).length).to.equal(1);
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

describe('HTTP revision CAS on PUT, DELETE, and restore', function () {
    var client;
    var previousDb;
    var db;
    var agent;
    var owner;

    before(async function () {
        previousDb = config.db;
        await config._clearDatabase();
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        config.db = db;
        things.resetCache();
        await require('../users.js').create('restoreuser', 'restore@example.com', 'Restore User', 'password123');
        var app = require('../http/app.js')({ sessionMemory: true, sessionSecret: 'restore-http-test-secret' });
        agent = require('supertest').agent(app);
        var login = await agent.post('/api/login')
            .send({ username: 'restoreuser', password: 'password123' }).expect(200);
        owner = login.body.user.id;
    });

    after(async function () {
        try {
            await config._clearDatabase();
        } finally {
            if (client) await client.close();
            config.db = previousDb;
        }
    });

    async function deletedNote(userId) {
        var note = await things.insertFull(userId || owner, 'Restore this note', [], [], [], 1, 1);
        await things.del(userId || owner, note._id, note.revision);
        return db.collection('things').findOne({ _id: new ObjectId(note._id) });
    }

    it('requires expectedRevision with 428 and leaves the deleted note unchanged', async function () {
        var note = await deletedNote();
        var response = await agent.post('/api/things/' + note._id + '/restore').send({}).expect(428);
        expect(response.body.code).to.equal('precondition_required');
        expect(await db.collection('things').findOne({ _id: note._id })).to.eql(note);
    });

    it('rejects invalid expectedRevision values at HTTP validation with 400', async function () {
        var note = await deletedNote();
        // Invalid values are rejected by the schema before the missing-revision 428 guard.
        for (var value of [null, '2', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
            var response = await agent.post('/api/things/' + note._id + '/restore')
                .send({ expectedRevision: value }).expect(400);
            expect(response.body.code).to.equal('invalid_request');
        }
        expect(await db.collection('things').findOne({ _id: note._id })).to.eql(note);
    });

    it('returns revision_conflict for a stale revision without restoring the note', async function () {
        var note = await deletedNote();
        var response = await agent.post('/api/things/' + note._id + '/restore')
            .send({ expectedRevision: note.revision - 1 }).expect(409);
        expect(response.body.code).to.equal('revision_conflict');
        expect(await db.collection('things').findOne({ _id: note._id })).to.eql(note);
    });

    it('returns revision_overflow at MAX_SAFE_INTEGER without restoring the note', async function () {
        var note = await deletedNote();
        note.revision = Number.MAX_SAFE_INTEGER;
        await db.collection('things').updateOne({ _id: note._id }, { $set: { revision: note.revision } });
        var response = await agent.post('/api/things/' + note._id + '/restore')
            .send({ expectedRevision: note.revision }).expect(409);
        expect(response.body.code).to.equal('revision_overflow');
        expect(await db.collection('things').findOne({ _id: note._id })).to.eql(note);
    });

    it('returns 404 for a nonexistent note', async function () {
        var response = await agent.post('/api/things/' + new ObjectId() + '/restore')
            .send({ expectedRevision: 1 }).expect(404);
        expect(response.body.code).to.equal('not_found');
    });

    it('returns 404 for another user\'s deleted note without changing it', async function () {
        var note = await deletedNote('another-restore-owner');
        var response = await agent.post('/api/things/' + note._id + '/restore')
            .send({ expectedRevision: note.revision }).expect(404);
        expect(response.body.code).to.equal('not_found');
        expect(await db.collection('things').findOne({ _id: note._id })).to.eql(note);
    });

    it('restores a deleted note with 200 and increments its revision', async function () {
        var note = await deletedNote();
        await agent.get('/api/things/' + note._id).expect(404);
        var response = await agent.post('/api/things/' + note._id + '/restore')
            .send({ expectedRevision: note.revision }).expect(200);
        expect(response.body.thing._id).to.equal(note._id.toString());
        expect(response.body.thing.content).to.equal(note.content);
        expect(response.body.thing.revision).to.equal(note.revision + 1);
        expect(response.body.thing.deletedAt).to.be(undefined);
        expect(response.body.thing.public).to.be(false);
        expect(response.body.thing.shared).to.be(false);

        var stored = await db.collection('things').findOne({ _id: note._id });
        expect(stored.deletedAt).to.be(undefined);
        expect(stored.revision).to.equal(note.revision + 1);
        var active = await agent.get('/api/things/' + note._id).expect(200);
        expect(active.body.thing.content).to.equal(note.content);
        expect(active.body.thing.revision).to.equal(note.revision + 1);
    });

    it('requires expectedRevision with 428 on PUT and DELETE and returns 409 on stale DELETE', async function () {
        var created = await agent.post('/api/things').send({ content: 'HTTP CAS target' }).expect(201);
        var id = created.body.thing._id;

        var putMissing = await agent.put('/api/things/' + id).send({ content: 'edited' }).expect(428);
        expect(putMissing.body.code).to.equal('precondition_required');

        var deleteMissing = await agent.delete('/api/things/' + id).send({}).expect(428);
        expect(deleteMissing.body.code).to.equal('precondition_required');

        var deleteStale = await agent.delete('/api/things/' + id).send({ expectedRevision: 999 }).expect(409);
        expect(deleteStale.body.code).to.equal('revision_conflict');

        var stillThere = await agent.get('/api/things/' + id).expect(200);
        expect(stillThere.body.thing.content).to.equal('HTTP CAS target');
        expect(stillThere.body.thing.revision).to.equal(1);
    });
});
