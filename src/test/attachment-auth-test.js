'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var fs = require('fs');
var path = require('path');
var request = require('supertest');
var config = require('../config.js');
var logic = require('../services/thing-service.js');
var users = require('../users.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('Attachment Authorization (RF-104)', function () {
    var app;
    var usersFilePath = '/tmp/meemo-attachment-test-' + process.pid + '.json';
    var prevUsersFile = process.env.USERS_FILE;
    var prevAttachmentDir = config.attachmentDir;
    var testAttachmentDir = '/tmp/meemo-attachment-storage-' + process.pid;

    var aliceAgent;
    var bobAgent;

    var alicePrivateThingId;
    var alicePublicThingId;
    var bobPrivateThingId;

    var alicePrivateFile = 'alice_secret_doc.txt';
    var alicePublicFile = 'alice_public_banner.txt';
    var aliceOrphanFile = 'alice_orphan_data.txt';
    var bobPrivateFile = 'bob_secret_notes.txt';

    before(function (done) {
        process.env.USERS_FILE = usersFilePath;
        config.attachmentDir = testAttachmentDir;
        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });

        config._clearDatabase(function (err) {
            if (err) return done(err);

            require('mongodb').MongoClient.connect(config.databaseUrl).then(function (client) {
                config.db = client.db();
                app = createApp({ sessionMemory: true });

                // Create accounts for alice and bob
                users.create('alice', 'alice@example.com', 'Alice', 'Password123!', function (err) {
                    if (err) return done(err);

                    users.create('bob', 'bob@example.com', 'Bob', 'Password123!', function (err) {
                        if (err) return done(err);

                        // Create storage folders and files
                        var aliceDir = path.join(testAttachmentDir, 'alice');
                        var bobDir = path.join(testAttachmentDir, 'bob');
                        fs.mkdirSync(aliceDir, { recursive: true });
                        fs.mkdirSync(bobDir, { recursive: true });

                        fs.writeFileSync(path.join(aliceDir, alicePrivateFile), 'Alice Private Secret');
                        fs.writeFileSync(path.join(aliceDir, alicePublicFile), 'Alice Public Content');
                        fs.writeFileSync(path.join(aliceDir, aliceOrphanFile), 'Alice Orphan Unlinked');
                        fs.writeFileSync(path.join(bobDir, bobPrivateFile), 'Bob Private Secret');

                        // Create notes for Alice: one private, one public
                        var privAttach = [{ identifier: alicePrivateFile, fileName: 'secret.txt', type: 'unknown' }];
                        logic.add('alice', 'Alice private note', privAttach, function (err, thing1) {
                            if (err) return done(err);
                            alicePrivateThingId = thing1._id.toString();

                            var pubAttach = [{ identifier: alicePublicFile, fileName: 'banner.txt', type: 'unknown' }];
                            logic.add('alice', 'Alice public note', pubAttach, function (err, thing2) {
                                if (err) return done(err);
                                var t2Id = thing2._id.toString();
                                // Make it public
                                logic.put('alice', t2Id, 'Alice public note', pubAttach, true, false, false, false, function (err, updated) {
                                    if (err) return done(err);
                                    alicePublicThingId = t2Id;

                                    // Create private note for Bob
                                    var bobAttach = [{ identifier: bobPrivateFile, fileName: 'bob.txt', type: 'unknown' }];
                                    logic.add('bob', 'Bob private note', bobAttach, function (err, thing3) {
                                        if (err) return done(err);
                                        bobPrivateThingId = thing3._id.toString();

                                        // Set up authenticated agents
                                        aliceAgent = request.agent(app);
                                        bobAgent = request.agent(app);

                                        aliceAgent
                                            .post('/api/login')
                                            .send({ username: 'alice', password: 'Password123!' })
                                            .expect(200)
                                            .end(function (err) {
                                                if (err) return done(err);

                                                bobAgent
                                                    .post('/api/login')
                                                    .send({ username: 'bob', password: 'Password123!' })
                                                    .expect(200)
                                                    .end(done);
                                            });
                                    });
                                });
                            });
                        });
                    });
                });
            }, done);
        });
    });

    after(function (done) {
        process.env.USERS_FILE = prevUsersFile;
        config.attachmentDir = prevAttachmentDir;
        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        config._clearDatabase(done);
    });

    describe('Private attachment access control', function () {
        it('allows owner to access own private attachment', function (done) {
            aliceAgent
                .get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.equal('Alice Private Secret');
                    done();
                });
        });

        it('blocks other authenticated user from accessing private attachment with 403', function (done) {
            bobAgent
                .get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile)
                .expect(403)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('blocks unauthenticated user from accessing private attachment with 403', function (done) {
            request(app)
                .get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile)
                .expect(403)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });
    });

    describe('Public note attachment access control', function () {
        it('allows unauthenticated user to access public note attachment', function (done) {
            request(app)
                .get('/api/files/alice/' + alicePublicThingId + '/' + alicePublicFile)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.equal('Alice Public Content');
                    done();
                });
        });

        it('allows other authenticated user to access public note attachment', function (done) {
            bobAgent
                .get('/api/files/alice/' + alicePublicThingId + '/' + alicePublicFile)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.equal('Alice Public Content');
                    done();
                });
        });
    });

    describe('Defense in depth: Association and path traversal', function () {
        it('blocks access to private attachment via public note URL with 404', function (done) {
            // Bob tries to access Alice's private file by guessing filename under Alice's public note
            bobAgent
                .get('/api/files/alice/' + alicePublicThingId + '/' + alicePrivateFile)
                .expect(404)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('blocks access to orphan files not linked to any note with 404', function (done) {
            aliceAgent
                .get('/api/files/alice/' + alicePublicThingId + '/' + aliceOrphanFile)
                .expect(404)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('returns 404 for nonexistent or invalid thingId', function (done) {
            request(app)
                .get('/api/files/alice/not-a-valid-id/' + alicePublicFile)
                .expect(404)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    request(app)
                        .get('/api/files/alice/507f1f77bcf86cd799439011/' + alicePublicFile)
                        .expect(404)
                        .end(function (err2, res2) {
                            expect(err2).to.be(null);
                            done();
                        });
                });
        });

        it('rejects path traversal attempts on identifier with 400', function (done) {
            aliceAgent
                .get('/api/files/alice/' + alicePublicThingId + '/..%2f..%2f.users.json')
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('rejects path traversal attempts on userId with 400', function (done) {
            aliceAgent
                .get('/api/files/..%2falice/' + alicePublicThingId + '/' + alicePublicFile)
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('returns 404 instead of 500 for an unknown attachment owner', function (done) {
            request(app)
                .get('/api/files/unknown-user/' + alicePublicThingId + '/' + alicePublicFile)
                .expect(404)
                .end(function (err) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('confirms deprecated /api/public/:userId/files/:fileId returns 404', function (done) {
            request(app)
                .get('/api/public/alice/files/' + alicePrivateFile)
                .expect(404)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    request(app)
                        .get('/api/public/alice/files/' + alicePublicFile)
                        .expect(404)
                        .end(function (err2, res2) {
                            expect(err2).to.be(null);
                            done();
                        });
                });
        });
    });
});
