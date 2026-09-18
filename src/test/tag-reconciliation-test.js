'use strict';

/* global describe:false */
/* global it:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js'),
    mongodb = require('mongodb'),
    MongoClient = mongodb.MongoClient,
    ObjectId = mongodb.ObjectId,
    config = require('../config.js'),
    tags = require('../database/tags.js'),
    things = require('../database/things.js'),
    thingService = require('../services/thing-service.js');

describe('Tag integrity', function () {
    this.timeout(10000);

    var client;
    var db;

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        config.db = db;
        tags.resetCache();
        things.resetCache();
        await tags.ensureIndexes();
    });

    beforeEach(async function () {
        await db.collection('system_maintenance').deleteMany({});
        await Promise.all([
            db.collection('things').deleteMany({}),
            db.collection('tags').deleteMany({})
        ]);
        things.resetCache();
    });

    afterEach(async function () {
        await db.collection('system_maintenance').deleteMany({});
    });

    after(async function () {
        await Promise.all([
            db.collection('things').deleteMany({}),
            db.collection('tags').deleteMany({}),
            db.collection('system_maintenance').deleteMany({})
        ]);
        await client.close();
    });

    it('derives exact owner-isolated usage through add, edit/archive, and delete', async function () {
        var first = await thingService.add('owner-a', '#same #same', []);
        await thingService.add('owner-b', '#same', []);
        expect(await thingService.getTags('owner-a')).to.eql([
            { ownerId: 'owner-a', name: 'same', usage: 2 }
        ]);

        var updatedFirst = await thingService.put(
            'owner-a', first._id, '#other', [], false, false, true, false, undefined, first.revision
        );
        expect(await thingService.getTags('owner-a')).to.eql([
            { ownerId: 'owner-a', name: 'other', usage: 1 }
        ]);
        expect(await thingService.getTags('owner-b')).to.eql([
            { ownerId: 'owner-b', name: 'same', usage: 1 }
        ]);

        await thingService.del('owner-a', first._id, updatedFirst.revision);
        expect(await thingService.getTags('owner-a')).to.eql([]);
    });

    it('reconstructs persisted tags atomically and repairs Thing tag arrays without manual locks', async function () {
        await Promise.all([
            things.insertFull('owner-a', '#keep #duplicate #duplicate', [], [], [], 1, 1),
            things.insertFull('owner-a', '#keep #missing', [], [], [], 2, 2),
            things.insertFull('owner-b', '#isolated', [], [], [], 3, 3),
            db.collection('tags').insertMany([
                { ownerId: 'owner-a', name: 'keep', usage: 99, createdAt: 1 },
                { ownerId: 'owner-a', name: 'duplicate', usage: 1, createdAt: 1 },
                { ownerId: 'owner-a', name: 'stale', usage: 4, createdAt: 1 },
                { ownerId: 'owner-b', name: 'isolated', usage: 7, createdAt: 1 },
                { ownerId: 'owner-without-things', name: 'stale-only', usage: 1, createdAt: 1 }
            ])
        ]);

        await thingService.cleanupTags();

        var ownerA = await db.collection('tags').find({ ownerId: 'owner-a' })
            .sort({ name: 1 }).toArray();
        var ownerB = await db.collection('tags').find({ ownerId: 'owner-b' }).toArray();
        expect(ownerA.map(function (tag) {
            return { name: tag.name, usage: tag.usage };
        })).to.eql([
            { name: 'duplicate', usage: 2 },
            { name: 'keep', usage: 2 },
            { name: 'missing', usage: 1 }
        ]);
        expect(ownerB.map(function (tag) {
            return { name: tag.name, usage: tag.usage };
        })).to.eql([{ name: 'isolated', usage: 1 }]);
        expect(await db.collection('tags').countDocuments({
            ownerId: 'owner-without-things'
        })).to.equal(0);
        expect((await db.collection('things').findOne({
            ownerId: 'owner-a', content: '#keep #duplicate #duplicate'
        })).tags).to.eql(['keep', 'duplicate', 'duplicate']);
    });

    it('does not overwrite concurrent note edits during tag reconstruction', async function () {
        var created = await things.insertFull('owner-a', '#old', [], [], [], 1, 1);
        var originalFind = mongodb.Collection.prototype.find;
        var injected = false;

        mongodb.Collection.prototype.find = function () {
            var cursor = originalFind.apply(this, arguments);
            if (this.collectionName === 'things' && !injected) {
                var realToArray = cursor.toArray.bind(cursor);
                cursor.toArray = async function () {
                    var res = await realToArray();
                    if (!injected) {
                        injected = true;
                        await things.put('owner-a', created._id, '#new', ['new'], [], [], false, false, false, false, undefined, created.revision);
                    }
                    return res;
                };
            }
            return cursor;
        };

        try {
            await thingService.cleanupTags();
        } finally {
            mongodb.Collection.prototype.find = originalFind;
        }

        var currentDoc = await db.collection('things').findOne({ _id: new ObjectId(created._id) });
        expect(currentDoc.content).to.equal('#new');
        expect(currentDoc.tags).to.eql(['new']);

        var onlineTags = await thingService.getTags('owner-a');
        expect(onlineTags).to.eql([{ ownerId: 'owner-a', name: 'new', usage: 1 }]);

        var persistedTags = await db.collection('tags').find({ ownerId: 'owner-a' }).toArray();
        expect(persistedTags.map(function (t) { return { name: t.name, usage: t.usage }; })).to.eql([
            { name: 'new', usage: 1 }
        ]);
    });

    it('captures concurrent note additions in reconstructed tags projection', async function () {
        await things.insertFull('owner-a', '#before', ['before'], [], [], 1, 1);

        var originalFind = mongodb.Collection.prototype.find;
        var injected = false;

        mongodb.Collection.prototype.find = function () {
            var cursor = originalFind.apply(this, arguments);
            if (this.collectionName === 'things' && !injected) {
                var realToArray = cursor.toArray.bind(cursor);
                cursor.toArray = async function () {
                    var res = await realToArray();
                    if (!injected) {
                        injected = true;
                        await things.insertFull('owner-a', '#during', ['during'], [], [], 2, 2);
                    }
                    return res;
                };
            }
            return cursor;
        };

        try {
            await thingService.cleanupTags();
        } finally {
            mongodb.Collection.prototype.find = originalFind;
        }

        var persistedTags = await db.collection('tags').find({ ownerId: 'owner-a' }).sort({ name: 1 }).toArray();
        expect(persistedTags.map(function (t) { return { name: t.name, usage: t.usage }; })).to.eql([
            { name: 'before', usage: 1 },
            { name: 'during', usage: 1 }
        ]);
    });

    it('enforces maintenance write freeze when active and fails closed when unverified', async function () {
        var verifyError;
        try {
            await things.requireWriteFreeze(db);
        } catch (error) {
            verifyError = error;
        }
        expect(verifyError).to.be.ok();
        expect(verifyError.message).to.contain('verified Thing write freeze is required');

        await things.acquireWriteFreeze();
        await things.requireWriteFreeze(db);

        var writeError;
        try {
            await things.insertFull('owner-a', '#blocked', [], [], [], 1, 1);
        } catch (error) {
            writeError = error;
        }
        expect(writeError).to.be.ok();
        expect(writeError.message).to.contain('writes are frozen for maintenance');

        await things.releaseWriteFreeze();

        var allowed = await things.insertFull('owner-a', '#allowed', ['allowed'], [], [], 1, 1);
        expect(allowed).to.be.ok();
    });

    it('linearizes put and del operations atomically and throws not found on absent deletion', async function () {
        var created = await things.insertFull('owner-a', '#initial', ['initial'], [], [], 1, 1);
        var updated = await things.put('owner-a', created._id, '#updated', ['updated'], [], [], false, false, false, false, undefined, created.revision);
        expect(updated.content).to.equal('#updated');
        expect(updated.tags).to.eql(['updated']);

        await things.del('owner-a', created._id, updated.revision);

        var delError;
        try {
            await things.del('owner-a', created._id, updated.revision);
        } catch (error) {
            delError = error;
        }
        expect(delError).to.be.ok();
        expect(delError.message).to.equal('not found');
    });
});
