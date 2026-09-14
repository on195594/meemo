/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    path = require('path'),
    childProcess = require('child_process'),
    migrator = require('../../scripts/migrate-data-to-v2.js'),
    users = require('../users.js');

function invoke(failure, value) {
    if (failure && failure.sync) throw failure.error;
    return failure ? Promise.reject(failure) : Promise.resolve(value);
}

function createDb(failures) {
    failures = failures || {};
    var calls = [];
    var legacyDocs = {
        alice_things: [{ _id: 'thing-1', content: 'note' }],
        alice_tags: [{ _id: 'tag-1', name: 'tag', usage: 1 }],
        alice_settings: [{ _id: 'settings-1', type: 'frontend', value: { title: 'Alice' } }]
    };

    function fail(key) {
        return failures[key] || null;
    }

    function record(key) {
        calls.push(key);
    }

    return {
        calls: calls,
        listCollections: function () {
            record('listCollections');
            if (fail('listCollections') && fail('listCollections').sync) throw fail('listCollections').error;
            return {
                toArray: function () {
                    record('listCollections.toArray');
                    return invoke(fail('listCollections.toArray'), [
                        { name: 'alice_things' },
                        { name: 'alice_tags' },
                        { name: 'alice_settings' }
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
                    return invoke(fail(key), docs[0] || null);
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

    beforeEach(function () {
        originalRepository = users.getRepository();
        users.setRepository({
            get: function () {
                return Promise.resolve({ id: 'alice-id', username: 'alice' });
            }
        });
    });

    afterEach(function () {
        users.setRepository(originalRepository);
    });

    it('aborts dry-run on a count error without starting later collection reads', function (done) {
        var secretUri = 'mongodb://rf704-user:rf704-secret@db.example/meemo';
        var db = createDb({
            'alice_things.countDocuments': new Error('read failed at ' + secretUri)
        });

        migrator.dryRun({ db: db }, function (error) {
            expectContext(error, 'dry-run', 'alice', 'alice_things', 'countDocuments');
            expect(error.message).not.to.contain(secretUri);
            expect(error.message).not.to.contain('rf704-secret');
            expect(db.calls).not.to.contain('alice_tags.countDocuments');
            expect(db.calls).not.to.contain('alice_settings.countDocuments');
            done();
        });
    });

    it('aborts apply on an index error before discovery or migration writes', function (done) {
        var db = createDb({
            'things.createIndex': new Error('index unavailable')
        });

        migrator.apply({ db: db }, function (error) {
            expectContext(error, 'apply:indexes', '<all>', 'things', 'createIndex');
            expect(db.calls).not.to.contain('listCollections');
            expect(db.calls).not.to.contain('things.replaceOne');
            done();
        });
    });

    it('aborts apply when find throws and does not start later user migration steps', function (done) {
        var db = createDb({
            'alice_things.find': { sync: true, error: new Error('find serialization failed') }
        });

        migrator.apply({ db: db }, function (error) {
            expectContext(error, 'apply:things', 'alice', 'alice_things', 'find');
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

        migrator.apply({ db: db }, function (error) {
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

        migrator.apply({ db: db }, function (error) {
            expectContext(error, 'apply:tags', 'alice', 'tags', 'updateOne');
            expect(db.calls).not.to.contain('alice_settings.findOne');
            expect(db.calls).not.to.contain('settings.replaceOne');
            done();
        });
    });

    it('aborts verify on a read error before later verification steps', function (done) {
        var db = createDb({
            'alice_things.toArray': new Error('legacy read failed')
        });

        migrator.verify({ db: db }, function (error) {
            expectContext(error, 'verify:things', 'alice', 'alice_things', 'toArray');
            expect(db.calls).not.to.contain('alice_tags.find');
            expect(db.calls).not.to.contain('alice_settings.findOne');
            done();
        });
    });

    it('normalizes resolver failures with safe migration context', function (done) {
        users.setRepository({
            get: function () {
                return Promise.reject(new Error('resolver unavailable'));
            }
        });
        var db = createDb();

        migrator.dryRun({ db: db }, function (error) {
            expectContext(error, 'dry-run', 'alice', 'users', 'resolveUser');
            expect(error.message).to.contain('resolver unavailable');
            done();
        });
    });

    it('reports connection close failures instead of returning success', function (done) {
        var db = createDb();

        migrator.dryRun({
            db: db,
            close: function (callback) { callback(new Error('close failed')); }
        }, function (error, report) {
            expectContext(error, 'dry-run', '<all>', '<database>', 'close');
            expect(report).to.be(undefined);
            done();
        });
    });

    it('adds context to verification mismatch failures', function (done) {
        var db = createDb();

        migrator.verify({ db: db }, function (error) {
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
            mongoUrl
        ], { encoding: 'utf8', timeout: 5000 });

        expect(result.status).not.to.equal(0);
        expect(result.stderr).to.contain('phase=dry-run');
        expect(result.stderr).to.contain('user=<all>');
        expect(result.stderr).to.contain('collection=<database>');
        expect(result.stderr).to.contain('operation=connect');
        expect(result.stderr).not.to.contain(mongoUrl);
        expect(result.stderr).not.to.contain(secret);
    });
});
