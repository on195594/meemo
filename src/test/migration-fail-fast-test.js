/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    fs = require('fs'),
    path = require('path'),
    childProcess = require('child_process'),
    MongoClient = require('mongodb').MongoClient,
    migrator = require('../../scripts/migrate-data-to-v2.js'),
    users = require('../users.js'),
    sourceExpectations = require('./migration-expected-source.js');

function invoke(failure, value) {
    if (failure && failure.sync) throw failure.error;
    return failure ? Promise.reject(failure) : Promise.resolve(value);
}

function createDb(failures) {
    failures = failures || {};
    var calls = [];
    var prefix = failures.prefix || 'alice';
    var legacyDocs = {};
    legacyDocs[prefix + '_things'] = [{ _id: 'thing-1', content: failures.thingContent || 'note' }];
    legacyDocs[prefix + '_tags'] = [{ _id: 'tag-1', name: 'tag', usage: 1 }];
    legacyDocs[prefix + '_settings'] = [
        { _id: 'settings-1', type: 'frontend', value: { title: 'Owner' } }
    ];
    if (failures.empty) Object.keys(legacyDocs).forEach(function (name) { legacyDocs[name] = []; });

    function fail(key) {
        return failures[key] || null;
    }

    function record(key) {
        calls.push(key);
    }

    return {
        calls: calls,
        databaseName: failures.databaseName || 'meemo-main',
        sourceDocuments: legacyDocs,
        listCollections: function () {
            record('listCollections');
            if (fail('listCollections') && fail('listCollections').sync) throw fail('listCollections').error;
            return {
                toArray: function () {
                    record('listCollections.toArray');
                    return invoke(fail('listCollections.toArray'), [
                        { name: prefix + '_things' },
                        { name: prefix + '_tags' },
                        { name: prefix + '_settings' }
                    ]);
                }
            };
        },
        collection: function (name) {
            return {
                createIndex: function () {
                    var key = name + '.createIndex';
                    record(key);
                    return invoke(fail(key), 'index');
                },
                countDocuments: function () {
                    var key = name + '.countDocuments';
                    record(key);
                    return invoke(fail(key), (legacyDocs[name] || []).length);
                },
                find: function () {
                    var key = name + '.find';
                    record(key);
                    if (fail(key) && fail(key).sync) throw fail(key).error;
                    return {
                        toArray: function () {
                            var arrayKey = name + '.toArray';
                            record(arrayKey);
                            return invoke(fail(arrayKey), legacyDocs[name] || []);
                        }
                    };
                },
                findOne: function () {
                    var key = name + '.findOne';
                    record(key);
                    var docs = legacyDocs[name] || [];
                    var value = name === 'system_migrations' ? failures.migrationState : docs[0];
                    return invoke(fail(key), value || null);
                },
                replaceOne: function () {
                    var key = name + '.replaceOne';
                    record(key);
                    return invoke(fail(key), { acknowledged: true });
                },
                updateOne: function () {
                    var key = name + '.updateOne';
                    record(key);
                    return invoke(fail(key), { acknowledged: true });
                }
            };
        }
    };
}

function expectContext(error, phase, user, collection, operation) {
    expect(error).to.be.ok();
    expect(error.message).to.contain('phase=' + phase);
    expect(error.message).to.contain('user=' + user);
    expect(error.message).to.contain('collection=' + collection);
    expect(error.message).to.contain('operation=' + operation);
}

describe('Migration fail-fast behavior (RF-704)', function () {
    var originalRepository;
    var expectedSource;
    var artifactFiles;

    beforeEach(function () {
        artifactFiles = [];
        originalRepository = users.getRepository();
        users.setRepository({
            get: function () {
                return Promise.resolve({ id: 'alice-id', username: 'alice' });
            }
        });
        var db = createDb();
        expectedSource = sourceExpectations.expectedSource(
            db.sourceDocuments, null, db.databaseName
        );
    });

    afterEach(function () {
        users.setRepository(originalRepository);
        artifactFiles.forEach(sourceExpectations.removeArtifact);
    });

    function reviewedOptions(db, expectation) {
        var artifact = sourceExpectations.writeArtifact(expectation || expectedSource);
        artifactFiles.push(artifact);
        return {
            db: db,
            expectedDatabase: db.databaseName,
            expectedSourceFile: artifact
        };
    }

    function verifiedDb(failures) {
        return createDb(Object.assign({}, failures || {}, {
            migrationState: {
                _id: 'schema-v2', sourceVersion: 1, targetVersion: 2,
                ownerMapDigest: 'no-owner-map',
                sourceEvidenceDigest: sourceExpectations.digest(expectedSource),
                phase: 'complete', startedAt: 1
            }
        }));
    }

    it('requires an explicit expected database for every mode', async function () {
        for (var method of ['dryRun', 'apply', 'verify']) {
            var db = createDb();
            var options = { db: db };
            if (method !== 'dryRun') {
                options.expectedSourceFile = reviewedOptions(db).expectedSourceFile;
            }
            var error = await new Promise(function (resolve) {
                migrator[method](options, function (caught) { resolve(caught); });
            });
            expect(error.message).to.contain('expected database is required');
            expect(db.calls).to.have.length(0);
        }
    });

    it('binds the argument, artifact, and actual database before source or state access', async function () {
        var actualMismatchDb = createDb();
        var argumentDatabase = 'meemo-other';
        var argumentExpectation = sourceExpectations.expectedSource(
            actualMismatchDb.sourceDocuments, null, argumentDatabase
        );
        var argumentArtifact = sourceExpectations.writeArtifact(argumentExpectation);
        artifactFiles.push(argumentArtifact);
        var actualMismatch = await new Promise(function (resolve) {
            migrator.apply({
                db: actualMismatchDb,
                expectedDatabase: argumentDatabase,
                expectedSourceFile: argumentArtifact
            }, function (error) { resolve(error); });
        });
        expect(actualMismatch.message).to.contain('does not match connected database');
        expect(actualMismatchDb.calls).to.have.length(0);

        var artifactMismatchDb = createDb();
        var artifactMismatch = await new Promise(function (resolve) {
            var expectation = sourceExpectations.expectedSource(
                artifactMismatchDb.sourceDocuments, null, 'meemo-other'
            );
            var options = reviewedOptions(artifactMismatchDb, expectation);
            migrator.verify(options, function (error) { resolve(error); });
        });
        expect(artifactMismatch.message).to.contain(
            'expected-source database does not match expected database'
        );
        expect(artifactMismatchDb.calls).to.have.length(0);

        var fixtureDatabase = createDb({ databaseName: 'meemo-fixture2' });
        var fixtureDatabaseError = await new Promise(function (resolve) {
            migrator.dryRun({
                db: fixtureDatabase,
                expectedDatabase: fixtureDatabase.databaseName
            }, function (error) { resolve(error); });
        });
        expect(fixtureDatabaseError.message).to.contain('Non-production database indicator');
        expect(fixtureDatabase.calls).to.have.length(0);
    });

    it('rejects a URI database mismatch before connecting and closes the client', async function () {
        var originalConnect = MongoClient.prototype.connect;
        var originalClose = MongoClient.prototype.close;
        var calls = [];
        var error;
        MongoClient.prototype.connect = function () {
            calls.push('connect');
            return Promise.resolve(this);
        };
        MongoClient.prototype.close = function () {
            calls.push('close');
            return Promise.resolve();
        };
        try {
            error = await new Promise(function (resolve) {
                migrator.dryRun({
                    mongoUrl: 'mongodb://private-user:private-password@db.invalid/meemo-actual',
                    expectedDatabase: 'meemo-expected'
                }, function (caught) { resolve(caught); });
            });
        } finally {
            MongoClient.prototype.connect = originalConnect;
            MongoClient.prototype.close = originalClose;
        }

        expect(error.message).to.contain('does not match connected database');
        expect(error.message).not.to.contain('private-password');
        expect(calls).to.eql(['close']);
    });

    it('requires independent matching source facts before any migration-state mutation', async function () {
        var missingDb = createDb();
        var missing = await new Promise(function (resolve) {
            migrator.apply({
                db: missingDb, expectedDatabase: missingDb.databaseName
            }, function (error) { resolve(error); });
        });
        expect(missing.message).to.contain('expected-source artifact is required');
        expect(missingDb.calls).to.have.length(0);

        var writableDb = createDb();
        var writableArtifact = sourceExpectations.writeArtifact(expectedSource);
        artifactFiles.push(writableArtifact);
        fs.chmodSync(writableArtifact, 0o600);
        var writable = await new Promise(function (resolve) {
            migrator.apply({
                db: writableDb,
                expectedDatabase: writableDb.databaseName,
                expectedSourceFile: writableArtifact
            }, function (error) { resolve(error); });
        });
        expect(writable.message).to.contain('missing or unreadable');
        expect(writableDb.calls).to.have.length(0);

        var dryRun = await new Promise(function (resolve, reject) {
            var db = createDb();
            migrator.dryRun({ db: db, expectedDatabase: db.databaseName }, function (error, report) {
                if (error) return reject(error);
                resolve(report);
            });
        });
        expect(dryRun).not.to.have.property('expectedSource');
        expect(dryRun).not.to.have.property('sourceManifest');
        var selfCertifiedDb = createDb();
        var selfCertified = await new Promise(function (resolve) {
            migrator.apply({
                db: selfCertifiedDb,
                expectedDatabase: selfCertifiedDb.databaseName,
                expectedSource: dryRun
            }, function (error) {
                resolve(error);
            });
        });
        expect(selfCertified.message).to.contain('expected-source artifact is invalid');
        expect(selfCertifiedDb.calls).to.have.length(0);

        var tinyDb = createDb({ empty: true });
        var tiny = await new Promise(function (resolve) {
            migrator.apply(reviewedOptions(tinyDb), function (error) { resolve(error); });
        });
        expect(tiny.message).to.contain('expected-source facts do not match');
        expect(tinyDb.calls).not.to.contain('system_migrations.updateOne');

        var staleDb = createDb({ thingContent: 'changed after review' });
        var closed = false;
        var stale = await new Promise(function (resolve) {
            var options = reviewedOptions(staleDb);
            options.close = function () { closed = true; };
            migrator.apply(options, function (error) { resolve(error); });
        });
        expect(stale.message).to.contain('expected-source facts do not match');
        expect(staleDb.calls).not.to.contain('system_migrations.updateOne');
        expect(closed).to.be(true);

        for (var prefix of ['test', 'fixture', 'sample', 'demo']) {
            var nonProductionDb = createDb({ prefix: prefix });
            var nonProductionExpectation = sourceExpectations.expectedSource(
                nonProductionDb.sourceDocuments, null, nonProductionDb.databaseName
            );
            var nonProductionError = await new Promise(function (resolve) {
                migrator.apply(reviewedOptions(
                    nonProductionDb, nonProductionExpectation
                ), function (error) { resolve(error); });
            });
            expect(nonProductionError.message).to.contain('Non-production namespace indicator');
            expect(nonProductionDb.calls).not.to.contain('system_migrations.updateOne');
        }

        var numericFixtureDb = createDb({ prefix: 'fixture2' });
        var numericFixtureExpectation = sourceExpectations.expectedSource(
            numericFixtureDb.sourceDocuments, null, numericFixtureDb.databaseName
        );
        var numericFixtureError = await new Promise(function (resolve) {
            migrator.apply(reviewedOptions(
                numericFixtureDb, numericFixtureExpectation
            ), function (error) { resolve(error); });
        });
        expect(numericFixtureError.message).to.contain('Non-production namespace indicator');
        expect(numericFixtureDb.calls).not.to.contain('system_migrations.updateOne');

        for (var normalCase of [
            { prefix: 'contest', databaseName: 'meemo-main' },
            { prefix: 'alice', databaseName: 'contest' }
        ]) {
            var normalDb = createDb(normalCase);
            var report = await new Promise(function (resolve, reject) {
                migrator.dryRun({
                    db: normalDb, expectedDatabase: normalDb.databaseName
                }, function (error, result) {
                    if (error) return reject(error);
                    resolve(result);
                });
            });
            expect(report.totalLegacyUsers).to.equal(1);
        }

        var labelled = Object.assign({ sourceFamily: 'production' }, nonProductionExpectation);
        var labelledError = await new Promise(function (resolve) {
            migrator.apply(reviewedOptions(nonProductionDb, labelled), function (error) {
                resolve(error);
            });
        });
        expect(labelledError.message).to.contain('expected-source artifact is invalid');

        var missingStateDb = createDb();
        var missingState = await new Promise(function (resolve) {
            migrator.verify(reviewedOptions(missingStateDb), function (error) { resolve(error); });
        });
        expect(missingState.message).to.contain('durable source-bound migration state');
        expect(missingStateDb.calls).not.to.contain('system_migrations.updateOne');
    });

    it('aborts dry-run on a count error without starting later collection reads', function (done) {
        var secretUri = 'mongodb://rf704-user:rf704-secret@db.example/meemo';
        var db = createDb({
            'alice_things.countDocuments': new Error('read failed at ' + secretUri)
        });

        migrator.dryRun({
            db: db, expectedDatabase: db.databaseName
        }, function (error) {
            expectContext(error, 'dry-run', 'alice', 'alice_things', 'countDocuments');
            expect(error.message).not.to.contain(secretUri);
            expect(error.message).not.to.contain('rf704-secret');
            expect(db.calls).not.to.contain('alice_tags.countDocuments');
            expect(db.calls).not.to.contain('alice_settings.countDocuments');
            done();
        });
    });

    it('aborts apply on an index error after source authority and before migration writes', function (done) {
        var db = createDb({
            'things.createIndex': new Error('index unavailable')
        });

        migrator.apply(reviewedOptions(db), function (error) {
            expectContext(error, 'apply:indexes', '<all>', 'things', 'createIndex');
            expect(db.calls.indexOf('listCollections')).to.be.lessThan(
                db.calls.indexOf('things.createIndex')
            );
            expect(db.calls).not.to.contain('things.replaceOne');
            done();
        });
    });

    it('aborts apply when find throws and does not start later user migration steps', function (done) {
        var db = createDb({
            'alice_things.find': { sync: true, error: new Error('find serialization failed') }
        });

        migrator.apply(reviewedOptions(db), function (error) {
            expectContext(error, 'apply:authority:things', 'alice', 'alice_things', 'find');
            expect(db.calls).not.to.contain('alice_tags.find');
            expect(db.calls).not.to.contain('alice_settings.findOne');
            done();
        });
    });

    it('aborts apply on a synchronous write serialization error without migrating tags', function (done) {
        var secretUri = 'mongodb+srv://rf704-user:rf704-secret@db.example/meemo';
        var db = createDb({
            'things.replaceOne': { sync: true, error: new Error('cannot serialize for ' + secretUri) }
        });

        migrator.apply(reviewedOptions(db), function (error) {
            expectContext(error, 'apply:things', 'alice', 'things', 'replaceOne');
            expect(error.message).not.to.contain(secretUri);
            expect(error.message).not.to.contain('rf704-secret');
            expect(db.calls).not.to.contain('tags.updateOne');
            done();
        });
    });

    it('aborts apply on a tag write error without migrating settings', function (done) {
        var db = createDb({
            'tags.updateOne': new Error('tag write failed')
        });

        migrator.apply(reviewedOptions(db), function (error) {
            expectContext(error, 'apply:tags', 'alice', 'tags', 'updateOne');
            expect(db.calls).not.to.contain('settings.replaceOne');
            done();
        });
    });

    it('aborts verify on a read error and closes the opened resource', async function () {
        var db = verifiedDb({
            'alice_things.toArray': new Error('legacy read failed')
        });
        var closed = false;
        var error = await new Promise(function (resolve) {
            var options = reviewedOptions(db);
            options.close = function () { closed = true; };
            migrator.verify(options, function (caught) { resolve(caught); });
        });

        expectContext(error, 'verify:authority:things', 'alice', 'alice_things', 'toArray');
        expect(closed).to.be(true);
        expect(db.calls).not.to.contain('system_migrations.updateOne');
    });

    it('normalizes resolver failures with safe migration context', function (done) {
        users.setRepository({
            get: function () {
                return Promise.reject(new Error('resolver unavailable'));
            }
        });
        var db = createDb();

        migrator.dryRun({
            db: db, expectedDatabase: db.databaseName
        }, function (error) {
            expectContext(error, 'dry-run', 'alice', 'users', 'resolveUser');
            expect(error.message).to.contain('resolver unavailable');
            done();
        });
    });

    it('reports connection close failures instead of returning success', function (done) {
        var db = createDb();

        migrator.dryRun({
            db: db,
            expectedDatabase: db.databaseName,
            close: function (callback) { callback(new Error('close failed')); }
        }, function (error, report) {
            expectContext(error, 'dry-run', '<all>', '<database>', 'close');
            expect(report).to.be(undefined);
            done();
        });
    });

    it('adds context to verification mismatch failures', function (done) {
        var db = verifiedDb();

        migrator.verify(reviewedOptions(db), function (error) {
            expectContext(error, 'verify', '<all>', '<unified>', 'fidelity-check');
            expect(error.message).to.contain('mismatches');
            done();
        });
    });

    it('exits the CLI nonzero with safe context when MongoDB connection fails', function () {
        var secret = 'rf704-cli-secret';
        var mongoUrl = 'mongodb://rf704-user:' + secret + '@127.0.0.1:1/meemo' +
            '?serverSelectionTimeoutMS=50&connectTimeoutMS=50';
        var result = childProcess.spawnSync(process.execPath, [
            path.resolve(__dirname, '../../scripts/migrate-data-to-v2.js'),
            '--dry-run',
            '--mongo-url',
            mongoUrl,
            '--expect-database',
            'meemo'
        ], { encoding: 'utf8', timeout: 5000 });

        expect(result.status).not.to.equal(0);
        expect(result.stderr).to.contain('DATA_MIGRATION_DRY_RUN_FAILED');
        expect(result.stderr).not.to.contain(mongoUrl);
        expect(result.stderr).not.to.contain(secret);
    });
});
