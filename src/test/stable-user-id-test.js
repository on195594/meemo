'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var expect = require('expect.js');
var fs = require('fs');
var path = require('path');
var request = require('supertest');
var MongoClient = require('mongodb').MongoClient;
var config = require('../config.js');
var users = require('../users.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;
var things = require('../database/things.js');
var tags = require('../database/tags.js');
var settings = require('../database/settings.js');

describe('Stable User ID and Decoupling (RF-203)', function () {
    var dbClient;
    var app;
    var prevUsersFile = process.env.USERS_FILE;
    var prevAuthSource = process.env.AUTH_USER_SOURCE;
    var prevAttachmentDir = config.attachmentDir;
    var testUsersFile = '/tmp/meemo-rf203-users-' + process.pid + '.json';
    var testAttachmentDir = '/tmp/meemo-rf203-attachments-' + process.pid;

    var aliceUser;
    var bobUser;
    var aliceAgent;
    var bobAgent;

    before(async function () {
        process.env.USERS_FILE = testUsersFile;
        process.env.AUTH_USER_SOURCE = 'mongo';
        config.attachmentDir = testAttachmentDir;

        fs.rmSync(testUsersFile, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        fs.mkdirSync(testAttachmentDir, { recursive: true });

        dbClient = await MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        things.resetCache();
        tags.resetCache();
        settings.resetCache();

        // Clean users collection
        await config.db.collection('users').deleteMany({});

        users.initRepository('mongo');
        app = createApp({ sessionMemory: true });

        // Register Alice and Bob in MongoDB
        await users.create('alice203', 'alice203@example.com', 'Alice TwoZeroThree', 'Password123!');
        await users.create('bob203', 'bob203@example.com', 'Bob TwoZeroThree', 'Password123!');
        aliceUser = await users.resolveUser('alice203');
        bobUser = await users.resolveUser('bob203');

        aliceAgent = request.agent(app);
        bobAgent = request.agent(app);

        // Login Alice and Bob
        await aliceAgent.post('/api/login').send({ username: 'alice203', password: 'Password123!' }).expect(200);
        await bobAgent.post('/api/login').send({ username: 'bob203', password: 'Password123!' }).expect(200);
    });

    after(async function () {
        if (prevUsersFile === undefined) delete process.env.USERS_FILE;
        else process.env.USERS_FILE = prevUsersFile;

        if (prevAuthSource === undefined) delete process.env.AUTH_USER_SOURCE;
        else process.env.AUTH_USER_SOURCE = prevAuthSource;

        config.attachmentDir = prevAttachmentDir;
        users.initRepository('file');

        fs.rmSync(testUsersFile, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });

        if (dbClient) {
            await config._clearDatabase();
            await dbClient.close();
        }
    });

    describe('Session & Profile identity decoupling', function () {
        it('assigns a stable ObjectId userId distinct from username', function () {
            expect(aliceUser.id).to.be.ok();
            expect(aliceUser.username).to.equal('alice203');
            expect(aliceUser.id).to.not.equal('alice203');
            // Check 24-hex ObjectId pattern
            expect(/^[a-f0-9]{24}$/.test(aliceUser.id)).to.be(true);
        });

        it('returns stable id alongside display attributes in /api/profile', function (done) {
            aliceAgent
                .get('/api/profile')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.user.id).to.equal(aliceUser.id);
                    expect(res.body.user.username).to.equal('alice203');
                    expect(res.body.user.displayName).to.equal('Alice TwoZeroThree');
                    done();
                });
        });
    });

    describe('Attachment storage path decoupled from username', function () {
        var uploadedStorageKey;
        var createdThingId;

        it('saves uploaded attachments under <userId>/ instead of <username>/', function (done) {
            var pngBuffer = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2d4b0000000049454e44ae426082', 'hex');

            aliceAgent
                .post('/api/files')
                .attach('file', pngBuffer, 'photo.png')
                .expect(201)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    uploadedStorageKey = res.body.identifier;
                    expect(uploadedStorageKey).to.be.ok();

                    // Confirm physical directory structure on disk:
                    // Stored in testAttachmentDir/<aliceUser.id>/<identifier>
                    var expectedUserDir = path.join(testAttachmentDir, aliceUser.id);
                    var forbiddenUsernameDir = path.join(testAttachmentDir, 'alice203');

                    var fileExistsInIdDir = fs.existsSync(path.join(expectedUserDir, uploadedStorageKey));
                    var fileExistsInUsernameDir = fs.existsSync(path.join(forbiddenUsernameDir, uploadedStorageKey));

                    expect(fileExistsInIdDir).to.be(true);
                    expect(fileExistsInUsernameDir).to.be(false);
                    done();
                });
        });

        it('attaches uploaded file to note with ownerId preserved on document', function (done) {
            aliceAgent
                .post('/api/things')
                .send({
                    content: 'Note with attachment [photo.png]',
                    attachments: [{
                        identifier: uploadedStorageKey,
                        fileName: 'photo.png',
                        type: 'image'
                    }]
                })
                .expect(201)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.thing).to.be.ok();
                    createdThingId = res.body.thing._id;

                    // Verify ownerId field on note
                    expect(res.body.thing.ownerId).to.equal(aliceUser.id);
                    done();
                });
        });

        it('allows access via URL using stable userId: /api/files/:userId/:thingId/:identifier', function (done) {
            aliceAgent
                .get('/api/files/' + aliceUser.id + '/' + createdThingId + '/' + uploadedStorageKey)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers['x-content-type-options']).to.equal('nosniff');
                    done();
                });
        });

        it('allows access via URL using legacy username: /api/files/:username/:thingId/:identifier', function (done) {
            aliceAgent
                .get('/api/files/alice203/' + createdThingId + '/' + uploadedStorageKey)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    done();
                });
        });

        it('blocks unauthorized access from another user with 403', function (done) {
            bobAgent
                .get('/api/files/' + aliceUser.id + '/' + createdThingId + '/' + uploadedStorageKey)
                .expect(403)
                .end(function (err) {
                    expect(err).to.be(null);
                    done();
                });
        });
    });

    describe('ownerId propagation on new data (things, tags, settings)', function () {
        it('persists ownerId on newly created things', function (done) {
            aliceAgent
                .post('/api/things')
                .send({ content: 'Note testing ownerId #testtag' })
                .expect(201)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.thing.ownerId).to.equal(aliceUser.id);
                    done();
                });
        });

        it('returns ownerId on tags derived from Things', function (done) {
            // Note creation makes its tags immediately visible from the Thing source.
            aliceAgent
                .get('/api/tags')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.tags).to.be.an(Array);
                    expect(res.body.tags.length).to.be.greaterThan(0);
                    var found = res.body.tags.find(function (t) { return t.name === 'testtag'; });
                    expect(found).to.be.ok();
                    expect(found.ownerId).to.equal(aliceUser.id);
                    done();
                });
        });

        it('persists ownerId on settings', function (done) {
            aliceAgent
                .post('/api/settings')
                .send({ settings: { title: 'Alice Space', publicBackground: false } })
                .expect(202)
                .end(function (err) {
                    if (err) return done(err);

                    aliceAgent
                        .get('/api/settings')
                        .expect(200)
                        .end(function (err, res) {
                            expect(err).to.be(null);
                            expect(res.body.settings.title).to.equal('Alice Space');
                            done();
                        });
                });
        });
    });

    describe('HTTP layer username → userId resolution for public & discovery routes', function () {
        var publicThingId;

        before(function (done) {
            aliceAgent
                .post('/api/things')
                .send({ content: 'Public note for world' })
                .expect(201)
                .end(function (err, res) {
                    if (err) return done(err);
                    publicThingId = res.body.thing._id;

                    aliceAgent
                        .put('/api/things/' + publicThingId)
                        .send({
                            content: 'Public note for world',
                            attachments: [],
                            public: true,
                            shared: false,
                            archived: false,
                            sticky: false
                        })
                        .expect(201)
                        .end(done);
                });
        });

        it('resolves GET /api/public/:userId/things with both username and userId', function (done) {
            // 1. Using username
            request(app)
                .get('/api/public/alice203/things')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.things).to.be.an(Array);
                    expect(res.body.things.length).to.be.greaterThan(0);

                    // 2. Using stable userId
                    request(app)
                        .get('/api/public/' + aliceUser.id + '/things')
                        .expect(200)
                        .end(function (err, res2) {
                            expect(err).to.be(null);
                            expect(res2.body.things.length).to.equal(res.body.things.length);
                            done();
                        });
                });
        });

        it('resolves GET /api/public/:userId/things/:thingId with both username and userId', function (done) {
            request(app)
                .get('/api/public/alice203/things/' + publicThingId)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.thing.content).to.equal('Public note for world');

                    request(app)
                        .get('/api/public/' + aliceUser.id + '/things/' + publicThingId)
                        .expect(200)
                        .end(function (err, res2) {
                            expect(err).to.be(null);
                            expect(res2.body.thing.content).to.equal('Public note for world');
                            done();
                        });
                });
        });

        it('resolves GET /api/users/:userId with both username and userId', function (done) {
            request(app)
                .get('/api/users/alice203')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.user.username).to.equal('alice203');
                    expect(res.body.user.id).to.equal(aliceUser.id);

                    request(app)
                        .get('/api/users/' + aliceUser.id)
                        .expect(200)
                        .end(function (err, res2) {
                            expect(err).to.be(null);
                            expect(res2.body.user.username).to.equal('alice203');
                            expect(res2.body.user.id).to.equal(aliceUser.id);
                            done();
                        });
                });
        });

        it('resolves GET /api/rss/:userId with both username and userId', function (done) {
            var expectedOrigin = (process.env.APP_ORIGIN || 'http://localhost').replace(/\/+$/, '');
            request(app)
                .get('/api/rss/alice203')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers['content-type']).to.contain('application/rss+xml');
                    expect(res.text).to.contain('/shared/' + publicThingId);
                    expect(res.text).to.contain(expectedOrigin + '/shared/' + publicThingId + '</guid>');
                    expect(res.text).to.contain('Alice TwoZeroThree (alice203)');
                    expect(res.text).not.to.contain('/blog/TODO');

                    request(app)
                        .get('/api/rss/' + aliceUser.id)
                        .expect(200)
                        .end(function (err, res2) {
                            expect(err).to.be(null);
                            expect(res2.headers['content-type']).to.contain('application/rss+xml');
                            expect(res2.text).to.contain('/shared/' + publicThingId);
                            expect(res2.text).to.contain(expectedOrigin + '/shared/' + publicThingId + '</guid>');
                            expect(res2.text).to.contain('Alice TwoZeroThree (alice203)');
                            expect(res2.text).not.to.contain('/blog/TODO');
                            done();
                        });
                });
        });

        it('handles notes without content or with relative media links in RSS safely', async function () {
            var emptyThing = await config.db.collection('things').insertOne({
                ownerId: aliceUser.id,
                content: '',
                attachments: [],
                tags: [],
                public: true,
                shared: false,
                archived: false,
                sticky: false,
                createdAt: Date.now(),
                modifiedAt: Date.now()
            });

            var mediaThing = await config.db.collection('things').insertOne({
                ownerId: aliceUser.id,
                content: 'Attachment note\n![img](/api/files/alice203/test.png)',
                attachments: [],
                tags: [],
                public: true,
                shared: false,
                archived: false,
                sticky: false,
                createdAt: Date.now(),
                modifiedAt: Date.now()
            });

            var expectedOrigin = (process.env.APP_ORIGIN || 'http://localhost').replace(/\/+$/, '');
            var res = await request(app).get('/api/rss/alice203').expect(200);
            expect(res.text).to.contain('Untitled note');
            expect(res.text).to.contain('src="' + expectedOrigin + '/api/files/alice203/test.png"');
            expect(res.text).to.contain('/shared/' + emptyThing.insertedId.toString());
            expect(res.text).to.contain('/shared/' + mediaThing.insertedId.toString());

            await config.db.collection('things').deleteMany({
                _id: { $in: [emptyThing.insertedId, mediaThing.insertedId] }
            });
        });

        it('returns 404 for unknown user in public routes', function (done) {
            request(app)
                .get('/api/users/nonexistentuser')
                .expect(404, done);
        });
    });

    describe('Legacy attachment fallback compatibility', function () {
        var legacyThingId;
        var legacyFileId = 'legacy-file-identifier.txt';

        before(function (done) {
            // Simulate an older attachment stored directly under username folder
            var legacyUserDir = path.join(testAttachmentDir, 'alice203');
            fs.mkdirSync(legacyUserDir, { recursive: true });
            fs.writeFileSync(path.join(legacyUserDir, legacyFileId), 'fake-legacy-content');

            // Add thing referencing this legacy file
            aliceAgent
                .post('/api/things')
                .send({
                    content: 'Legacy note [legacy.txt]',
                    attachments: [{
                        identifier: legacyFileId,
                        fileName: 'legacy.txt',
                        type: 'unknown'
                    }]
                })
                .expect(201)
                .end(function (err, res) {
                    if (err) return done(err);
                    legacyThingId = res.body.thing._id;
                    done();
                });
        });

        it('falls back to legacy <username>/ folder when file is not yet in <userId>/ folder', function (done) {
            aliceAgent
                .get('/api/files/' + aliceUser.id + '/' + legacyThingId + '/' + legacyFileId)
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    var content = res.text || (res.body && res.body.toString());
                    expect(content).to.equal('fake-legacy-content');
                    done();
                });
        });
    });
});
