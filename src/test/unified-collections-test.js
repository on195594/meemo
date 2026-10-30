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
var thingService = require('../services/thing-service.js');
var tags = require('../database/tags.js');
var settings = require('../database/settings.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('Unified Collections Model & Shadow Migration (RF-204)', function () {
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

        things.resetCache();
        tags.resetCache();
        settings.resetCache();

        // Ensure indexes on unified collections
        await things.ensureIndexes();
        await tags.ensureIndexes();
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

            // ownerId + modifiedAt
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, modifiedAt: -1 }));
            // ownerId + sticky + modifiedAt
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, sticky: -1, modifiedAt: -1 }));
            // ownerId + archived + modifiedAt
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, archived: 1, modifiedAt: -1 }));
            // ownerId + tags
            expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, tags: 1 }));
        });

        it('creates unique compound index on unified tags collection', async function () {
            var idxs = await db.collection('tags').indexes();
            var tagCompound = idxs.find(function (idx) {
                return idx.key && idx.key.ownerId === 1 && idx.key.name === 1;
            });
            expect(tagCompound).to.be.ok();
            expect(tagCompound.unique).to.be(true);
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

        it('queries things filtered by ownerId using the runtime search filter', function (done) {
            things.getAll(testUserId, thingService.buildSearchFilter('Unified'), 0, 10, function (err, list) {
                if (err) return done(err);
                expect(list).to.be.an(Array);
                expect(list.length).to.equal(1);
                expect(list[0]._id).to.equal(createdThingId);

                // Ensure another owner cannot see this note
                things.getAll('other-owner', {}, 0, 10, function (err, otherList) {
                    if (err) return done(err);
                    expect(otherList.length).to.equal(0);
                    done();
                });
            });
        });

        it('updates and deletes note in unified collection', function (done) {
            things.put(testUserId, createdThingId, 'Updated unified content', ['unified'], [], [], false, false, false, false, 'sage', 1, function (err, updated) {
                if (err) return done(err);
                expect(updated.content).to.equal('Updated unified content');
                expect(updated.color).to.equal('sage');

                things.del(testUserId, createdThingId, updated.revision, function (err) {
                    if (err) return done(err);

                    things.get(testUserId, createdThingId, function (err) {
                        expect(err).to.be.ok();
                        expect(err.message).to.equal('not found');
                        done();
                    });
                });
            });
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

    describe('Unified-only runtime and pagination (VR-205/VR-206/VR-207)', function () {
        var thingOwner = 'rf703_partial_owner';
        var paginationOwner = 'vr207_pagination_owner';
        var settingsOwner = 'rf703_settings_owner';
        var legacyThings;
        var paginationThings;

        before(function (done) {
            legacyThings = Array.from({ length: 100 }, function (_, index) {
                return {
                    _id: new ObjectId(),
                    content: 'legacy-' + index,
                    tags: [],
                    attachments: [],
                    externalContent: [],
                    createdAt: index,
                    modifiedAt: index,
                    sticky: index % 25 === 0
                };
            });

            var copiedThings = legacyThings.slice(0, 40).map(function (thing) {
                return Object.assign({}, thing, {
                    ownerId: thingOwner,
                    content: 'unified-' + thing.modifiedAt,
                    archived: thing.modifiedAt === 0
                });
            });

            paginationThings = [1, 6, 3, 5, 2, 4].map(function (suffix) {
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

            Promise.all([
                db.collection(thingOwner + '_things').insertMany(legacyThings),
                db.collection('things').insertMany(copiedThings),
                db.collection('things').insertMany(paginationThings),
                db.collection(settingsOwner + '_settings').insertOne({
                    type: 'frontend',
                    value: { title: 'Legacy title', legacyOnly: true }
                }),
                db.collection('settings').insertOne({
                    ownerId: settingsOwner,
                    type: 'frontend',
                    value: { title: 'Unified title' }
                })
            ]).then(function () { done(); }, done);
        });

        after(function (done) {
            Promise.all([
                db.collection(thingOwner + '_things').drop().catch(function () {}),
                db.collection('things').deleteMany({ ownerId: thingOwner }),
                db.collection('things').deleteMany({ ownerId: paginationOwner }),
                db.collection(settingsOwner + '_settings').drop().catch(function () {}),
                db.collection('settings').deleteMany({ ownerId: settingsOwner })
            ]).then(function () { done(); }, done);
        });

        it('reads things only from the Unified collection', function () {
            return things.getAll(thingOwner, {}, 0, 0).then(function (list) {
                expect(list.length).to.equal(40);
                expect(list.find(function (thing) {
                    return thing._id === String(legacyThings[0]._id);
                }).content).to.equal('unified-0');
            });
        });

        it('sorts and paginates Unified things', function () {
            return things.getAll(thingOwner, {}, 2, 5).then(function (list) {
                expect(list.map(function (thing) { return thing.modifiedAt; })).to.eql([39, 38, 37, 36, 35]);
            });
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

        it('does not expose a Legacy duplicate excluded by the Unified query', function () {
            var query = { $or: [{ archived: false }, { archived: { $exists: false } }] };
            return things.getAll(thingOwner, query, 0, 0).then(function (list) {
                expect(list.length).to.equal(39);
                expect(list.some(function (thing) {
                    return thing._id === String(legacyThings[0]._id);
                })).to.be(false);
            });
        });

        it('does not resume Legacy reads after the runtime cache resets', function () {
            var nextCopies = legacyThings.slice(40, 50).map(function (thing) {
                return Object.assign({}, thing, { ownerId: thingOwner });
            });

            return db.collection('things').insertMany(nextCopies).then(function () {
                things.resetCache();
                return things.getAllLean(thingOwner);
            }).then(function (list) {
                expect(list.length).to.equal(50);
            });
        });

        it('reads settings only from the Unified collection', function () {
            return settings.get(settingsOwner).then(function (value) {
                expect(value).to.eql({ title: 'Unified title' });
            });
        });

        it('writes settings only to the Unified collection', function () {
            return settings.put(settingsOwner, { title: 'Updated title' }).then(function () {
                return Promise.all([
                    db.collection('settings').findOne({ ownerId: settingsOwner }),
                    db.collection(settingsOwner + '_settings').findOne({ type: 'frontend' })
                ]);
            }).then(function (results) {
                expect(results[0].value).to.eql({ title: 'Updated title' });
                expect(results[1].value).to.eql({ title: 'Legacy title', legacyOnly: true });
            });
        });

        it('uses the current database after runtime database replacement', function () {
            var originalDb = config.db;
            var firstCollections = {};
            var secondCollections = {};
            function fakeDb(collections) {
                return {
                    collection: function (name) {
                        if (!collections[name]) {
                            collections[name] = { createIndex: function () { return Promise.resolve(); } };
                        }
                        return collections[name];
                    }
                };
            }

            try {
                things.resetCache();
                tags.resetCache();
                settings.resetCache();
                config.db = fakeDb(firstCollections);
                things.getUnifiedCollection();
                tags.getUnifiedCollection();
                settings.getUnifiedCollection();

                config.db = fakeDb(secondCollections);
                expect(things.getUnifiedCollection()).to.equal(secondCollections.things);
                expect(tags.getUnifiedCollection()).to.equal(secondCollections.tags);
                expect(settings.getUnifiedCollection()).to.equal(secondCollections.settings);
            } finally {
                config.db = originalDb;
                things.resetCache();
                tags.resetCache();
                settings.resetCache();
            }
        });
    });

});
