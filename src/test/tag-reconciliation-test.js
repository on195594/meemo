'use strict';

/* global describe:false */
/* global it:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js'),
    MongoClient = require('mongodb').MongoClient,
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

        await thingService.put(
            'owner-a', first._id, '#other', [], false, false, true, false
        );
        expect(await thingService.getTags('owner-a')).to.eql([
            { ownerId: 'owner-a', name: 'other', usage: 1 }
        ]);
        expect(await thingService.getTags('owner-b')).to.eql([
            { ownerId: 'owner-b', name: 'same', usage: 1 }
        ]);

        await thingService.del('owner-a', first._id);
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

    it('allows concurrent Thing mutations during tag reconstruction without manual lock errors', async function () {
        await things.insertFull('owner-a', '#before', [], [], [], 1, 1);
        var original = tags.replaceAll;
        var duringWriteResult;
        tags.replaceAll = async function (documents) {
            duringWriteResult = await things.insertFull('owner-a', '#during', [], [], [], 2, 2);
            return original(documents);
        };
        try {
            await thingService.cleanupTags();
        } finally {
            tags.replaceAll = original;
        }

        expect(duringWriteResult).to.be.ok();
        expect(await db.collection('things').countDocuments({ content: '#during' })).to.equal(1);
        expect(await db.collection('system_maintenance').countDocuments({})).to.equal(0);
    });
});
