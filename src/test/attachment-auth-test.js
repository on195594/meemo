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
    var dbClient;
    var previousDb;
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

    before(async function () {
        previousDb = config.db;
        config.attachmentDir = testAttachmentDir;
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });

        await config._clearDatabase();
        dbClient = await require('mongodb').MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        app = createApp({ sessionMemory: true });

        // Create accounts for alice and bob
        await users.create('alice', 'alice@example.com', 'Alice', 'Password123!');
        await users.create('bob', 'bob@example.com', 'Bob', 'Password123!');

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
        var thing1 = await logic.add('alice', 'Alice private note', privAttach);
        alicePrivateThingId = thing1._id.toString();

        var pubAttach = [{ identifier: alicePublicFile, fileName: 'banner.txt', type: 'unknown' }];
        var thing2 = await logic.add('alice', 'Alice public note', pubAttach);
        var t2Id = thing2._id.toString();
        // Make it public
        await logic.put('alice', t2Id, 'Alice public note', pubAttach, true, false, false, false, undefined, thing2.revision);
        alicePublicThingId = t2Id;

        // Create private note for Bob
        var bobAttach = [{ identifier: bobPrivateFile, fileName: 'bob.txt', type: 'unknown' }];
        var thing3 = await logic.add('bob', 'Bob private note', bobAttach);
        bobPrivateThingId = thing3._id.toString();

        // Set up authenticated agents
        aliceAgent = request.agent(app);
        bobAgent = request.agent(app);
        await aliceAgent.post('/api/login').send({ username: 'alice', password: 'Password123!' }).expect(200);
        await bobAgent.post('/api/login').send({ username: 'bob', password: 'Password123!' }).expect(200);
    });

    after(async function () {
        try {
            config.attachmentDir = prevAttachmentDir;
            fs.rmSync(testAttachmentDir, { recursive: true, force: true });
            await config._clearDatabase();
        } finally {
            config.db = previousDb;
            if (dbClient) await dbClient.close();
        }
    });

    describe('Private attachment access control', function () {
        it('allows owner to access own private attachment', function (done) {
            aliceAgent
                .get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.equal('Alice Private Secret');
                    // Owner-only files are never stored by shared proxies and always revalidate with the session.
                    expect(res.headers['cache-control']).to.equal('private, no-cache');
                    done();
                });
        });

        it('answers the owner\'s revalidation with 304 instead of the file body', async function () {
            var first = await aliceAgent.get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile).expect(200);
            expect(first.headers.etag).to.be.ok();
            await aliceAgent.get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile)
                .set('If-None-Match', first.headers.etag).expect(304);
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

    describe('Attachment download responses', function () {
        it('serves non-image attachments with an attachment filename', async function () {
            var response = await aliceAgent
                .get('/api/files/alice/' + alicePrivateThingId + '/' + alicePrivateFile).expect(200);
            expect(response.headers['content-disposition']).to.equal('attachment; filename="secret.txt"');
        });

        it('encodes spaces and special characters in download filenames', async function () {
            var fileName = 'report 100% #1.txt';
            var note = await logic.add('alice', 'Encoded download', [{
                identifier: alicePrivateFile, fileName: fileName, type: 'unknown'
            }]);
            var response = await aliceAgent
                .get('/api/files/alice/' + note._id + '/' + alicePrivateFile).expect(200);
            expect(response.headers['content-disposition'])
                .to.equal('attachment; filename="report%20100%25%20%231.txt"');
        });

        it('returns a clean 404 when an attached file disappears from disk', async function () {
            var identifier = 'missing-on-disk.txt';
            var filePath = path.join(testAttachmentDir, 'alice', identifier);
            fs.writeFileSync(filePath, 'Temporary attachment');
            var attachment = { identifier: identifier, fileName: 'missing.txt', type: 'unknown' };
            var note = await logic.add('alice', 'Missing file', [attachment]);
            var url = '/api/files/alice/' + note._id + '/' + identifier;
            await aliceAgent.get(url).expect(200);
            fs.unlinkSync(filePath);

            var response = await aliceAgent.get(url).expect(404);
            expect(response.body).to.eql({
                status: 'Not Found', code: 'not_found', message: 'file not found'
            });
            expect(response.text).not.to.contain(testAttachmentDir);
            expect((await logic.get('alice', note._id)).attachments).to.eql([attachment]);
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
                    expect(res.headers['cache-control']).to.equal('public, max-age=0');
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
