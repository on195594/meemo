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

    before(function (done) {
        this.timeout(20000);

        // Clear database first before establishing test client
        config._clearDatabase(function (err) {
            if (err) return done(err);

            MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (err, client) {
                if (err) return done(err);
                dbClient = client;
                db = client.db();
                config.db = db;

                things.resetCache();
                tags.resetCache();
                settings.resetCache();

                // Ensure indexes on unified collections
                things.ensureIndexes(function (err) {
                    if (err) return done(err);
                    tags.ensureIndexes(function (err) {
                        if (err) return done(err);
                        settings.ensureIndexes(function (err) {
                            if (err) return done(err);
                            app = createApp({ sessionMemory: true });
                            done();
                        });
                    });
                });
            });
        });
    });

    after(function (done) {
        if (dbClient) {
            config._clearDatabase(function () {
                dbClient.close(done);
            });
        } else {
            done();
        }
    });

    describe('Index creation on unified collections', function () {
        it('creates required indexes on unified things collection', function (done) {
            db.collection('things').indexes(function (err, idxs) {
                if (err) return done(err);
                expect(idxs).to.be.an(Array);

                var keyPatterns = idxs.map(function (idx) { return JSON.stringify(idx.key); });

                // ownerId + modifiedAt
                expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, modifiedAt: -1 }));
                // ownerId + sticky + modifiedAt
                expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, sticky: -1, modifiedAt: -1 }));
                // ownerId + archived + modifiedAt
                expect(keyPatterns).to.contain(JSON.stringify({ ownerId: 1, archived: 1, modifiedAt: -1 }));
                // text(content)
                var hasText = idxs.some(function (idx) { return idx.weights && idx.weights.content; });
                expect(hasText).to.be(true);

                done();
            });
        });

        it('creates unique compound index on unified tags collection', function (done) {
            db.collection('tags').indexes(function (err, idxs) {
                if (err) return done(err);
                var tagCompound = idxs.find(function (idx) {
                    return idx.key && idx.key.ownerId === 1 && idx.key.name === 1;
                });
                expect(tagCompound).to.be.ok();
                expect(tagCompound.unique).to.be(true);
                done();
            });
        });

        it('creates unique ownerId index on unified settings collection', function (done) {
            db.collection('settings').indexes(function (err, idxs) {
                if (err) return done(err);
                var settingUnique = idxs.find(function (idx) {
                    return idx.key && idx.key.ownerId === 1;
                });
                expect(settingUnique).to.be.ok();
                expect(settingUnique.unique).to.be(true);
                done();
            });
        });
    });

    describe('CRUD operations directly against unified collections', function () {
        var testUserId = 'test-owner-id-123';
        var createdThingId;

        it('inserts new thing into unified things collection with ownerId', function (done) {
            things.addFull(testUserId, 'Unified note test content #unified', ['unified'], [], [], Date.now(), Date.now(), function (err, doc) {
                if (err) return done(err);
                expect(doc).to.be.ok();
                expect(doc.ownerId).to.equal(testUserId);
                createdThingId = doc._id;

                // Directly verify in MongoDB 'things' collection
                db.collection('things').findOne({ _id: new ObjectId(createdThingId) }, function (err, mongoDoc) {
                    if (err) return done(err);
                    expect(mongoDoc).to.be.ok();
                    expect(mongoDoc.ownerId).to.equal(testUserId);
                    expect(mongoDoc.content).to.equal('Unified note test content #unified');
                    done();
                });
            });
        });

        it('queries things filtered by ownerId and supports full-text search', function (done) {
            things.getAll(testUserId, { $text: { $search: 'Unified' } }, 0, 10, function (err, list) {
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

        it('persists settings in unified settings collection', function (done) {
            settings.put(testUserId, { title: 'My Unified Meemo' }, function (err) {
                if (err) return done(err);

                settings.get(testUserId, function (err, res) {
                    if (err) return done(err);
                    expect(res.title).to.equal('My Unified Meemo');

                    // Check direct Mongo document
                    db.collection('settings').findOne({ ownerId: testUserId }, function (err, doc) {
                        if (err) return done(err);
                        expect(doc).to.be.ok();
                        expect(doc.value.title).to.equal('My Unified Meemo');
                        done();
                    });
                });
            });
        });
    });

    describe('Data Migration Script (migrate-data-to-v2.js)', function () {
        var legacyOwner1 = 'legacyuser_alpha';
        var legacyOwner2 = 'legacyuser_beta';

        before(function (done) {
            // Seed legacy per-user collections
            var things1 = [
                { _id: new ObjectId(), content: 'Alpha note 1 #alpha', tags: ['alpha'], createdAt: 1000, modifiedAt: 1000, attachments: [] },
                { _id: new ObjectId(), content: 'Alpha note 2 #work', tags: ['work'], createdAt: 2000, modifiedAt: 2000, attachments: [] }
            ];
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

            db.collection(legacyOwner1 + '_things').insertMany(things1, function (err) {
                if (err) return done(err);
                db.collection(legacyOwner1 + '_tags').insertMany(tags1, function (err) {
                    if (err) return done(err);
                    db.collection(legacyOwner1 + '_settings').insertMany(settings1, function (err) {
                        if (err) return done(err);
                        db.collection(legacyOwner2 + '_things').insertMany(things2, function (err) {
                            if (err) return done(err);
                            db.collection(legacyOwner2 + '_tags').insertMany(tags2, done);
                        });
                    });
                });
            });
        });

        it('--dry-run discovers legacy collections without writing to unified collections', function (done) {
            migrator.dryRun({ db: db }, function (err, report) {
                if (err) return done(err);
                expect(report.totalLegacyUsers).to.be.greaterThan(1);
                expect(report.totalThingsToMigrate).to.equal(3);
                expect(report.totalTagsToMigrate).to.equal(3);
                expect(report.totalSettingsToMigrate).to.equal(1);

                // Confirm unified collections have not received these notes yet
                db.collection('things').countDocuments({ ownerId: legacyOwner1 }, function (err, count) {
                    if (err) return done(err);
                    expect(count).to.equal(0);
                    done();
                });
            });
        });

        it('--apply migrates legacy collections into unified collections idempotently', function (done) {
            migrator.apply({ db: db }, function (err, stats) {
                if (err) return done(err);
                expect(stats.migratedThings).to.equal(3);
                expect(stats.migratedTags).to.equal(3);
                expect(stats.migratedSettings).to.equal(1);

                // Verify docs now reside in unified things
                db.collection('things').find({ ownerId: legacyOwner1 }).toArray(function (err, docs) {
                    if (err) return done(err);
                    expect(docs.length).to.equal(2);
                    expect(docs[0].ownerId).to.equal(legacyOwner1);

                    // Re-apply to verify idempotence (should not duplicate)
                    migrator.apply({ db: db }, function (err2, stats2) {
                        if (err2) return done(err2);

                        db.collection('things').countDocuments({ ownerId: legacyOwner1 }, function (err, countAgain) {
                            if (err) return done(err);
                            expect(countAgain).to.equal(2);
                            done();
                        });
                    });
                });
            });
        });

        it('--verify validates complete data fidelity between legacy and unified collections', function (done) {
            migrator.verify({ db: db }, function (err, result) {
                if (err) return done(err);
                expect(result.success).to.be(true);
                expect(result.mismatches.length).to.equal(0);
                expect(result.verifiedUsers).to.be.greaterThan(1);
                done();
            });
        });

        it('--verify detects tampering or missing data', function (done) {
            // Delete one document from unified collection
            db.collection('things').deleteOne({ ownerId: legacyOwner2 }, function (err) {
                if (err) return done(err);

                migrator.verify({ db: db }, function (err, result) {
                    expect(err).to.be.ok();
                    expect(err.message).to.contain('Verification failed');
                    done();
                });
            });
        });

        it('supports standalone mongoUrl execution without shared db', function (done) {
            // Test that running standalone dryRun with mongoUrl works cleanly
            migrator.dryRun({ mongoUrl: config.databaseUrl }, function (err, report) {
                if (err) return done(err);
                expect(report.totalLegacyUsers).to.be.greaterThan(0);
                // Verify our test suite's db connection remains open and functional
                db.collection('things').countDocuments({}, function (err, count) {
                    if (err) return done(err);
                    expect(count).to.be.greaterThan(0);
                    done();
                });
            });
        });
    });
});
