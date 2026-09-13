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
var migrator = require('../../scripts/migrate-data-to-v2.js');
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
            var doc = await things.addFull(testUserId, 'Unified note test content #unified', ['unified'], [], [], Date.now(), Date.now());
            expect(doc).to.be.ok();
            expect(doc.ownerId).to.equal(testUserId);
            createdThingId = doc._id;

            // Directly verify in MongoDB 'things' collection
            var mongoDoc = await db.collection('things').findOne({ _id: new ObjectId(createdThingId) });
            expect(mongoDoc).to.be.ok();
            expect(mongoDoc.ownerId).to.equal(testUserId);
            expect(mongoDoc.content).to.equal('Unified note test content #unified');
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
            things.put(testUserId, createdThingId, 'Updated unified content', ['unified'], [], [], false, false, false, false, function (err, updated) {
                if (err) return done(err);
                expect(updated.content).to.equal('Updated unified content');

                things.del(testUserId, createdThingId, function (err) {
                    if (err) return done(err);

                    things.get(testUserId, createdThingId, function (err) {
                        expect(err).to.be.ok();
                        expect(err.message).to.equal('not found');
                        done();
                    });
                });
            });
        });

        it('persists tags in unified tags collection with usage increment', function (done) {
            tags.update(testUserId, 'javascript', function (err) {
                if (err) return done(err);

                tags.update(testUserId, 'javascript', function (err) {
                    if (err) return done(err);

                    tags.get(testUserId, function (err, list) {
                        if (err) return done(err);
                        expect(list.length).to.equal(1);
                        expect(list[0].name).to.equal('javascript');
                        expect(list[0].ownerId).to.equal(testUserId);
                        expect(list[0].usage).to.equal(2);
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

    describe('Migration dual-read correctness (RF-703)', function () {
        var thingOwner = 'rf703_partial_owner';
        var tagOwner = 'rf703_tag_owner';
        var settingsOwner = 'rf703_settings_owner';
        var legacyThings;

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

            Promise.all([
                db.collection(thingOwner + '_things').insertMany(legacyThings),
                db.collection('things').insertMany(copiedThings),
                db.collection(tagOwner + '_tags').insertMany([
                    { _id: new ObjectId(), name: 'alpha', usage: 1, createdAt: 1 },
                    { _id: new ObjectId(), name: 'beta', usage: 5, createdAt: 2 }
                ]),
                db.collection('tags').insertMany([
                    { ownerId: tagOwner, name: 'alpha', usage: 10, createdAt: 3 },
                    { ownerId: tagOwner, name: 'gamma', usage: 2, createdAt: 4 }
                ]),
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
                db.collection(tagOwner + '_tags').drop().catch(function () {}),
                db.collection('tags').deleteMany({ ownerId: tagOwner }),
                db.collection(settingsOwner + '_settings').drop().catch(function () {}),
                db.collection('settings').deleteMany({ ownerId: settingsOwner })
            ]).then(function () { done(); }, done);
        });

        it('shows all 100 unique things when 40 have been copied and Unified wins duplicates', function () {
            return things.getAll(thingOwner, {}, 0, 0).then(function (list) {
                expect(list.length).to.equal(100);
                expect(new Set(list.map(function (thing) { return thing._id; })).size).to.equal(100);
                expect(list.find(function (thing) {
                    return thing._id === String(legacyThings[0]._id);
                }).content).to.equal('unified-0');
            });
        });

        it('sorts and paginates only after merging both thing sources', function () {
            return things.getAll(thingOwner, {}, 2, 5).then(function (list) {
                expect(list.map(function (thing) { return thing.modifiedAt; })).to.eql([25, 0, 99, 98, 97]);
            });
        });

        it('filters the winning Unified version instead of exposing a stale Legacy duplicate', function () {
            var query = { $or: [{ archived: false }, { archived: { $exists: false } }] };
            return things.getAll(thingOwner, query, 0, 0).then(function (list) {
                expect(list.length).to.equal(99);
                expect(list.some(function (thing) {
                    return thing._id === String(legacyThings[0]._id);
                })).to.be(false);
            });
        });

        it('keeps all 100 things visible after an interrupted copy and restart', function () {
            var nextCopies = legacyThings.slice(40, 50).map(function (thing) {
                return Object.assign({}, thing, { ownerId: thingOwner });
            });

            return db.collection('things').insertMany(nextCopies).then(function () {
                things.resetCache();
                return things.getAllLean(thingOwner);
            }).then(function (list) {
                expect(list.length).to.equal(100);
                expect(new Set(list.map(function (thing) { return thing._id; })).size).to.equal(100);
            });
        });

        it('merges tags by name, prefers Unified, and sorts the merged result', function () {
            return tags.get(tagOwner).then(function (list) {
                expect(list.map(function (tag) { return tag.name; })).to.eql(['alpha', 'beta', 'gamma']);
                expect(list[0].usage).to.equal(10);
            });
        });

        it('treats settings as a singleton and prefers Unified without field merging', function () {
            return settings.get(settingsOwner).then(function (value) {
                expect(value).to.eql({ title: 'Unified title' });
            });
        });
    });

    describe('Data Migration Script (migrate-data-to-v2.js)', function () {
        var legacyOwner1 = 'legacyuser_alpha';
        var legacyOwner2 = 'legacyuser_beta';
        var protectedThingId;

        before(function () {
            // Seed legacy per-user collections
            var things1 = [
                { _id: new ObjectId(), content: 'Alpha note 1 #alpha', tags: ['alpha'], createdAt: 1000, modifiedAt: 1000, attachments: [] },
                { _id: new ObjectId(), content: 'Alpha note 2 #work', tags: ['work'], createdAt: 2000, modifiedAt: 2000, attachments: [] }
            ];
            protectedThingId = things1[0]._id;
            var tags1 = [
                { _id: new ObjectId(), name: 'alpha', usage: 1 },
                { _id: new ObjectId(), name: 'work', usage: 1 }
            ];
            var settings1 = [
                { _id: new ObjectId(), type: 'frontend', value: { title: 'Alpha Space' } }
            ];

            var things2 = [
                { _id: new ObjectId(), content: 'Beta note 1 #beta', tags: ['beta'], createdAt: 3000, modifiedAt: 3000, attachments: [] }
            ];
            var tags2 = [
                { _id: new ObjectId(), name: 'beta', usage: 3 }
            ];

            return Promise.all([
                db.collection(legacyOwner1 + '_things').insertMany(things1),
                db.collection(legacyOwner1 + '_tags').insertMany(tags1),
                db.collection(legacyOwner1 + '_settings').insertMany(settings1),
                db.collection(legacyOwner2 + '_things').insertMany(things2),
                db.collection(legacyOwner2 + '_tags').insertMany(tags2)
            ]);
        });

        it('--dry-run discovers legacy collections without writing to unified collections', function (done) {
            migrator.dryRun({ db: db }, function (err, report) {
                if (err) return done(err);
                expect(report.totalLegacyUsers).to.be.greaterThan(1);
                expect(report.totalThingsToMigrate).to.equal(3);
                expect(report.totalTagsToMigrate).to.equal(3);
                expect(report.totalSettingsToMigrate).to.equal(1);

                // Confirm unified collections have not received these notes yet
                db.collection('things').countDocuments({ ownerId: legacyOwner1 }).then(function (count) {
                    expect(count).to.equal(0);
                    done();
                }).catch(done);
            });
        });

        it('--apply records copied state and migrates legacy collections idempotently', function (done) {
            migrator.apply({ db: db }, function (err, stats) {
                if (err) return done(err);
                expect(stats.migratedThings).to.equal(3);
                expect(stats.migratedTags).to.equal(3);
                expect(stats.migratedSettings).to.equal(1);

                db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                    expect(state.sourceVersion).to.equal(1);
                    expect(state.targetVersion).to.equal(2);
                    expect(state.phase).to.equal('copied');
                    expect(state.startedAt).to.be.a('number');
                    expect(state.copiedAt).to.be.a('number');

                    return db.collection('things').find({ ownerId: legacyOwner1 }).toArray();
                }).then(function (docs) {
                    expect(docs.length).to.equal(2);
                    expect(docs[0].ownerId).to.equal(legacyOwner1);
                    done();
                }).catch(done);
            });
        });

        it('--verify rejects pending, copying, and failed without changing phase', function (done) {
            var phases = ['pending', 'copying', 'failed'];

            function verifyPhase(index) {
                if (index === phases.length) {
                    db.collection('system_migrations').updateOne(
                        { _id: 'schema-v2' },
                        { $set: { phase: 'copied' } }
                    ).then(function () { done(); }).catch(done);
                    return;
                }

                var phase = phases[index];
                db.collection('system_migrations').updateOne(
                    { _id: 'schema-v2' },
                    { $set: { phase: phase } }
                ).then(function () {
                    migrator.verify({ db: db }, function (err, result) {
                        expect(err).to.be.ok();
                        expect(err.message).to.contain('phase=verify:state');
                        expect(err.message).to.contain('Cannot verify migration from phase ' + phase);
                        expect(result).to.be(undefined);

                        db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                            expect(state.phase).to.equal(phase);
                            verifyPhase(index + 1);
                        }).catch(done);
                    });
                }).catch(done);
            }

            verifyPhase(0);
        });

        it('--verify marks copied migration failed on fidelity errors', function (done) {
            db.collection('things').deleteOne({ ownerId: legacyOwner2 }).then(function () {
                migrator.verify({ db: db }, function (err, result) {
                    expect(err).to.be.ok();
                    expect(err.message).to.contain('Verification failed');
                    expect(result).to.be(undefined);
                    db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                        expect(state.phase).to.equal('failed');
                        done();
                    }).catch(done);
                });
            }).catch(done);
        });

        it('preserves newer Unified things, tags, and settings across rerun and verification', function (done) {
            db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                var editedAt = state.startedAt + 1;

                Promise.all([
                    db.collection('things').updateOne({ _id: protectedThingId }, {
                        $set: { content: 'edited after migration start', modifiedAt: editedAt }
                    }),
                    db.collection('tags').updateOne({ ownerId: legacyOwner1, name: 'alpha' }, {
                        $set: { usage: 42, modifiedAt: editedAt }
                    }),
                    db.collection('settings').updateOne({ ownerId: legacyOwner1 }, {
                        $set: { value: { title: 'Edited after migration start' }, modifiedAt: editedAt }
                    })
                ]).then(function () {
                    migrator.apply({ db: db }, function (err) {
                        if (err) return done(err);

                        migrator.verify({ db: db }, function (err, result) {
                            if (err) return done(err);
                            expect(result.success).to.be(true);

                            Promise.all([
                                db.collection('things').findOne({ _id: protectedThingId }),
                                db.collection('tags').findOne({ ownerId: legacyOwner1, name: 'alpha' }),
                                db.collection('settings').findOne({ ownerId: legacyOwner1 })
                            ]).then(function (docs) {
                                var note = docs[0];
                                var tag = docs[1];
                                var setting = docs[2];
                                expect(note.content).to.equal('edited after migration start');
                                expect(note.modifiedAt).to.equal(editedAt);
                                expect(tag.usage).to.equal(42);
                                expect(tag.modifiedAt).to.equal(editedAt);
                                expect(setting.value).to.eql({ title: 'Edited after migration start' });
                                expect(setting.modifiedAt).to.equal(editedAt);
                                done();
                            }).catch(done);
                        });
                    });
                }).catch(done);
            }).catch(done);
        });

        it('--verify is idempotent in verified phase without changing state', function (done) {
            db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (before) {
                expect(before.phase).to.equal('verified');
                expect(before.verifiedAt).to.be.a('number');

                migrator.verify({ db: db }, function (err, result) {
                    if (err) return done(err);
                    expect(result.success).to.be(true);

                    db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (after) {
                        expect(after.phase).to.equal('verified');
                        expect(after.verifiedAt).to.equal(before.verifiedAt);
                        done();
                    }).catch(done);
                });
            }).catch(done);
        });

        it('--verify is read-only in cutover and complete phases', function (done) {
            var phases = ['cutover', 'complete'];

            db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (initialState) {
                function verifyPhase(index) {
                    if (index === phases.length) return done();

                    var phase = phases[index];
                    db.collection('system_migrations').updateOne(
                        { _id: 'schema-v2' },
                        { $set: { phase: phase } }
                    ).then(function () {
                        migrator.verify({ db: db }, function (err, result) {
                            if (err) return done(err);
                            expect(result.success).to.be(true);

                            db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                                expect(state.phase).to.equal(phase);
                                expect(state.verifiedAt).to.equal(initialState.verifiedAt);
                                verifyPhase(index + 1);
                            }).catch(done);
                        });
                    }).catch(done);
                }

                verifyPhase(0);
            }).catch(done);
        });

        it('refuses --apply after migration state is complete', function (done) {
            migrator.apply({ db: db }, function (err, stats) {
                expect(err).to.be.ok();
                expect(err.message).to.contain('phase=apply:state');
                expect(err.message).to.contain('already complete');
                expect(stats).to.be(undefined);
                done();
            });
        });

        it('--verify detects tampering without changing complete phase', function (done) {
            db.collection('things').deleteOne({ ownerId: legacyOwner2 }).then(function () {
                migrator.verify({ db: db }, function (err, result) {
                    expect(err).to.be.ok();
                    expect(err.message).to.contain('Verification failed');
                    expect(result).to.be(undefined);
                    db.collection('system_migrations').findOne({ _id: 'schema-v2' }).then(function (state) {
                        expect(state.phase).to.equal('complete');
                        done();
                    }).catch(done);
                });
            }).catch(done);
        });

        it('supports standalone mongoUrl execution without shared db', function (done) {
            // Test that running standalone dryRun with mongoUrl works cleanly
            migrator.dryRun({ mongoUrl: config.databaseUrl }, function (err, report) {
                if (err) return done(err);
                expect(report.totalLegacyUsers).to.be.greaterThan(0);
                // Verify our test suite's db connection remains open and functional
                db.collection('things').countDocuments({}).then(function (count) {
                    expect(count).to.be.greaterThan(0);
                    done();
                }).catch(done);
            });
        });
    });
});
