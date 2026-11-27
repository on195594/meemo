'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var assert = require('assert');
var expect = require('expect.js');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var config = require('../config.js');
var things = require('../database/things.js');
var thingService = require('../services/thing-service.js');
var settings = require('../database/settings.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('Unified Collections Model (RF-204)', function () {
    this.timeout(20000);

    var dbClient;
    var db;
    var app;

    before(async function () {
        this.timeout(20000);

        // Clear database first before establishing test client
        await config._clearDatabase();
        dbClient = await MongoClient.connect(config.databaseUrl);
        db = dbClient.db();
        config.db = db;

        settings.resetCache();

        // Ensure indexes on unified collections
        await things.ensureIndexes();
        await settings.ensureIndexes();
        app = createApp({ sessionMemory: true });
    });

    after(async function () {
        if (dbClient) {
            await config._clearDatabase();
            await dbClient.close();
        }
    });

    describe('Index creation on unified collections', function () {
        it('creates required indexes on unified things collection', async function () {
            var idxs = await db.collection('things').indexes();
            expect(idxs).to.be.an(Array);

            var keyPatterns = idxs.map(function (idx) { return JSON.stringify(idx.key); });

            // ownerId + modifiedAt (lean reads)
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, modifiedAt: -1 }));
            // ownerId + deletedAt + archived + sticky + modifiedAt + _id (active & trash feeds)
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, deletedAt: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }));
            // ownerId + deletedAt + tags + archived + sticky + modifiedAt + _id (tag-filtered feeds)
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, deletedAt: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }));
            // sparse attachment identifier lookup for orphan GC
            expect(keyPatterns).to.contain(JSON.stringify({ 'attachments.identifier': 1 }));
        });

        it('creates unique ownerId index on unified settings collection', async function () {
            var idxs = await db.collection('settings').indexes();
            var settingUnique = idxs.find(function (idx) {
                return idx.key && idx.key.ownerId === 1;
            });
            expect(settingUnique).to.be.ok();
            expect(settingUnique.unique).to.be(true);
        });
    });

    describe('CRUD operations directly against unified collections', function () {
        var testUserId = 'test-owner-id-123';
        var createdThingId;

        it('inserts new thing into unified things collection with ownerId', async function () {
            var doc = await things.addFull(testUserId, 'Unified note test content #unified', ['unified'], [], [], Date.now(), Date.now(), 'mint');
            expect(doc).to.be.ok();
            expect(doc.ownerId).to.equal(testUserId);
            expect(doc.color).to.equal('mint');
            createdThingId = doc._id;

            // Directly verify in MongoDB 'things' collection
            var mongoDoc = await db.collection('things').findOne({ _id: new ObjectId(createdThingId) });
            expect(mongoDoc).to.be.ok();
            expect(mongoDoc.ownerId).to.equal(testUserId);
            expect(mongoDoc.content).to.equal('Unified note test content #unified');
            expect(mongoDoc.color).to.equal('mint');
        });

        it('rejects unsupported colors in direct database writes', async function () {
            var insertError;
            try {
                await things.insertFull(testUserId, 'Invalid color', [], [], [], 1, 1, 'red');
            } catch (error) {
                insertError = error;
            }
            expect(insertError).to.be.ok();
            expect(insertError.code).to.equal('ERR_INVALID_NOTE_COLOR');

            var putError;
            try {
                await things.put(testUserId, createdThingId, 'Invalid color update', [], [], [],
                    false, false, false, false, 'red', 1);
            } catch (error) {
                putError = error;
            }
            expect(putError).to.be.ok();
            expect(putError.code).to.equal('ERR_INVALID_NOTE_COLOR');
        });

        it('queries things filtered by ownerId using the runtime search filter', async function () {
            var list = await things.getAll(testUserId, thingService.buildSearchFilter('Unified'), 0, 10);
            expect(list).to.be.an(Array);
            expect(list.length).to.equal(1);
            expect(list[0]._id).to.equal(createdThingId);
            var otherList = await things.getAll('other-owner', {}, 0, 10);
            expect(otherList.length).to.equal(0);
        });

        it('updates and deletes note in unified collection', async function () {
            var updated = await things.put(testUserId, createdThingId, 'Updated unified content', ['unified'], [], [], false, false, false, false, 'sage', 1);
            expect(updated.content).to.equal('Updated unified content');
            expect(updated.color).to.equal('sage');
            await things.del(testUserId, createdThingId, updated.revision);
            await assert.rejects(things.get(testUserId, createdThingId), { message: 'not found' });
        });

        it('persists settings in unified settings collection', async function () {
            await settings.put(testUserId, { title: 'My Unified Meemo' });
            var res = await settings.get(testUserId);
            expect(res.title).to.equal('My Unified Meemo');

            // Check direct Mongo document
            var doc = await db.collection('settings').findOne({ ownerId: testUserId });
            expect(doc).to.be.ok();
            expect(doc.value.title).to.equal('My Unified Meemo');
        });
    });

    describe('Unified pagination and tie-breaking (VR-207)', function () {
        var paginationOwner = 'vr207_pagination_owner';

        before(async function () {
            var paginationThings = [1, 6, 3, 5, 2, 4].map(function (suffix) {
                return {
                    _id: new ObjectId('00000000000000000000000' + suffix),
                    ownerId: paginationOwner,
                    content: 'vr207-' + suffix,
                    tags: [],
                    attachments: [],
                    externalContent: [],
                    createdAt: 207,
                    modifiedAt: 207,
                    public: true,
                    shared: false,
                    archived: false,
                    sticky: suffix === 2 || suffix === 5
                };
            });

            await db.collection('things').insertMany(paginationThings);
        });

        after(async function () {
            await db.collection('things').deleteMany({ ownerId: paginationOwner });
        });

        it('orders equal timestamps deterministically across pages and lean reads', async function () {
            var firstPage = await things.getAll(paginationOwner, {}, 0, 3);
            var secondPage = await things.getAll(paginationOwner, {}, 3, 3);
            var ids = firstPage.concat(secondPage).map(function (thing) { return thing._id; });

            expect(ids).to.eql([
                '000000000000000000000005',
                '000000000000000000000002',
                '000000000000000000000006',
                '000000000000000000000004',
                '000000000000000000000003',
                '000000000000000000000001'
            ]);
            expect(new Set(ids).size).to.equal(6);

            var lean = await things.getAllLean(paginationOwner);
            expect(lean.map(function (thing) { return thing._id; })).to.eql([
                '000000000000000000000006',
                '000000000000000000000005',
                '000000000000000000000004',
                '000000000000000000000003',
                '000000000000000000000002',
                '000000000000000000000001'
            ]);
        });

        it('keeps authenticated and public pagination in parity', async function () {
            var authenticated = await thingService.getAll(paginationOwner, {}, 0, 3);
            var published = await thingService.getAllPublic(paginationOwner, {}, 0, 3);

            expect(published.map(function (thing) { return thing._id; })).to.eql(
                authenticated.map(function (thing) { return thing._id; }));
        });
    });

});
