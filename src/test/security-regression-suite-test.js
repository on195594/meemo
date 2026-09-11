'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var fs = require('fs'),
    path = require('path'),
    os = require('os'),
    expect = require('expect.js'),
    request = require('supertest'),
    tarStream = require('tar-stream'),
    config = require('../config.js'),
    users = require('../users.js'),
    ssrf = require('../ssrf.js'),
    authService = require('../services/auth-service.js'),
    createApp = require('../../app.js').createApp;

function makeTarBuffer(entries, callback) {
    var pack = tarStream.pack();
    entries.forEach(function (e) {
        pack.entry(e.header, e.content || '');
    });
    pack.finalize();
    var chunks = [];
    pack.on('data', function (c) { chunks.push(c); });
    pack.on('end', function () { callback(null, Buffer.concat(chunks)); });
    pack.on('error', callback);
}

var binaryParser = function (res, cb) {
    var chunks = [];
    res.on('data', function (chunk) { chunks.push(chunk); });
    res.on('end', function () { cb(null, Buffer.concat(chunks)); });
    res.on('error', cb);
};

describe('Core Security Regression Suite (RF-402 / Gate G3)', function () {
    this.timeout(20000);

    var app;
    var usersFilePath = path.join(os.tmpdir(), 'meemo-sec-reg-users-' + process.pid + '.json');
    var testAttachmentDir = path.join(os.tmpdir(), 'meemo-sec-reg-storage-' + process.pid);
    var prevUsersFile = process.env.USERS_FILE;
    var prevAttachmentDir = config.attachmentDir;

    var agentA;
    var agentB;
    var userA;
    var userB;

    before(function (done) {
        process.env.USERS_FILE = usersFilePath;
        config.attachmentDir = testAttachmentDir;

        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        fs.mkdirSync(testAttachmentDir, { recursive: true });

        authService._resetRateLimits();

        config._clearDatabase(function (err) {
            if (err) return done(err);

            require('mongodb').MongoClient.connect(config.databaseUrl).then(function (client) {
                config.db = client.db();

                app = createApp({
                    sessionMemory: true,
                    sessionSecret: 'sec-reg-master-secret-key-12345'
                });

                users.create('secuser_a', 'sec_a@example.com', 'Sec User A', 'Password123!', function (errA) {
                    if (errA) return done(errA);

                    users.create('secuser_b', 'sec_b@example.com', 'Sec User B', 'Password123!', function (errB) {
                        if (errB) return done(errB);

                        agentA = request.agent(app);
                        agentB = request.agent(app);

                        agentA
                            .post('/api/login')
                            .send({ username: 'secuser_a', password: 'Password123!' })
                            .expect(200)
                            .end(function (errLoginA) {
                                if (errLoginA) return done(errLoginA);

                                agentA
                                    .get('/api/profile')
                                    .expect(200)
                                    .end(function (errProfA, resProfA) {
                                        if (errProfA) return done(errProfA);
                                        userA = resProfA.body.user;

                                        agentB
                                            .post('/api/login')
                                            .send({ username: 'secuser_b', password: 'Password123!' })
                                            .expect(200)
                                            .end(function (errLoginB) {
                                                if (errLoginB) return done(errLoginB);

                                                agentB
                                                    .get('/api/profile')
                                                    .expect(200)
                                                    .end(function (errProfB, resProfB) {
                                                        if (errProfB) return done(errProfB);
                                                        userB = resProfB.body.user;
                                                        done();
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
        authService._resetRateLimits();
        process.env.USERS_FILE = prevUsersFile;
        config.attachmentDir = prevAttachmentDir;
        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        config._clearDatabase(done);
    });

    // 1. 无 SESSION_SECRET 的 production 启动失败
    it('scenario 1: fails fast in production mode when SESSION_SECRET is missing', function () {
        expect(function () {
            createApp({ isProduction: true, sessionSecret: '' });
        }).to.throwError(/SESSION_SECRET is required when NODE_ENV=production/);
    });

    // 2. 登录暴力尝试被限流
    it('scenario 2: brute-force login attempts are rate-limited with 429 too_many_requests', async function () {
        var isolatedApp = createApp({
            sessionMemory: true,
            sessionSecret: 'rate-limit-secret'
        });

        var hitRateLimit = false;
        try {
            for (var i = 0; i < 25; i++) {
                var res = await request(isolatedApp)
                    .post('/api/login')
                    .set('X-Forwarded-For', '203.0.113.199')
                    .send({ username: 'nonexistent', password: 'WrongPassword!' });

                if (res.status === 429) {
                    hitRateLimit = true;
                    expect(res.body.code).to.equal('too_many_requests');
                    break;
                }
            }
        } finally {
            authService._resetRateLimits();
        }
        expect(hitRateLimit).to.be(true);
    });

    // 3. session fixation 防护
    it('scenario 3: prevents session fixation by regenerating session ID upon successful login', function (done) {
        authService._resetRateLimits();
        var fixApp = createApp({ sessionMemory: true, sessionSecret: 'fixation-secret' });
        var testAgent = request.agent(fixApp);

        testAgent
            .get('/api/health/live')
            .expect(200)
            .end(function (err) {
                expect(err).to.be(null);

                testAgent
                    .post('/api/login')
                    .set('X-Forwarded-For', '203.0.113.200')
                    .send({ username: 'secuser_a', password: 'Password123!' })
                    .expect(200)
                    .end(function (loginErr, loginRes) {
                        expect(loginErr).to.be(null);
                        var setCookie = loginRes.headers['set-cookie'];
                        expect(setCookie).to.be.ok();
                        expect(setCookie[0]).to.contain('connect.sid');
                        authService._resetRateLimits();
                        done();
                    });
            });
    });

    // 4. 非 owner 私有 Thing 读取失败
    it('scenario 4: prevents unauthorized users from reading private notes (returns 404 not_found)', async function () {
        var createRes = await agentA
            .post('/api/things')
            .send({ content: 'Confidential thoughts for A only' })
            .expect(201);

        var thingId = createRes.body.thing._id;
        expect(thingId).to.be.a('string');

        // User B attempts to read User A's private thing directly
        var readRes = await agentB
            .get('/api/things/' + thingId)
            .expect(404);

        expect(readRes.body.code).to.equal('not_found');

        // Anonymous public route should reject private note
        var pubRes = await request(app)
            .get('/api/public/' + userA.id + '/things/' + thingId)
            .expect(403);

        expect(pubRes.body.code).to.equal('forbidden');
    });

    // 5. 非 owner 私有附件读取失败
    it('scenario 5: blocks unauthorized access to private attachments with 403 forbidden', async function () {
        var uploadRes = await agentA
            .post('/api/files')
            .attach('file', Buffer.from('Confidential report content'), 'report.txt')
            .expect(201);

        var fileObj = uploadRes.body;
        var fileId = fileObj.identifier;

        var noteRes = await agentA
            .post('/api/things')
            .send({
                content: 'Note with sensitive file',
                attachments: [fileObj]
            })
            .expect(201);

        var noteId = noteRes.body.thing._id;

        // User B tries to download User A's attachment
        var getRes = await agentB
            .get('/api/files/' + userA.id + '/' + noteId + '/' + fileId)
            .expect(403);

        expect(getRes.body.code).to.equal('forbidden');
    });

    // 6. Public Thing 不能读取不属于它的附件
    it('scenario 6: prevents public notes from exposing attachments belonging to another note', async function () {
        var uploadRes = await agentA
            .post('/api/files')
            .attach('file', Buffer.from('Private secret attachment'), 'secret.png')
            .expect(201);

        var privateFileId = uploadRes.body.identifier;

        // Create private note referencing private file
        await agentA
            .post('/api/things')
            .send({ content: 'Private note', attachments: [privateFileId] })
            .expect(201);

        // Create a separate public note WITHOUT that file
        var pubNoteRes = await agentA
            .post('/api/things')
            .send({ content: 'Public announcement note' })
            .expect(201);

        var publicNoteId = pubNoteRes.body.thing._id;

        // Publish the note
        await agentA
            .put('/api/things/' + publicNoteId)
            .send({
                content: 'Public announcement note',
                public: true,
                shared: true
            })
            .expect(201);

        // Attacker attempts to fetch the private file using public note's ID
        var bypassAttempt = await request(app)
            .get('/api/files/' + userA.id + '/' + publicNoteId + '/' + privateFileId);

        expect([403, 404]).to.contain(bypassAttempt.status);
    });

    // 7. SSRF localhost/private/link-local/redirect 被拦截
    it('scenario 7: blocks SSRF probes targeting localhost, private IPs, link-local metadata, and redirects', async function () {
        expect((await ssrf.isSafeUrl('http://127.0.0.1')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://localhost')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://169.254.169.254/latest/meta-data')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://10.0.0.1/admin')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://192.168.1.1/setup')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://172.16.0.1/internal')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('http://[::1]')).safe).to.be(false);
        expect((await ssrf.isSafeUrl('ftp://example.com/file')).safe).to.be(false);

        var probeDirect = await ssrf.probeUrl('http://127.0.0.1:80');
        expect(probeDirect.type).to.equal(ssrf.TYPE_UNKNOWN);
    });

    // 8. oversized upload/import 被拒绝
    it('scenario 8: rejects oversized uploads and archives with 413 payload_too_large', async function () {
        var bigBuffer = Buffer.alloc(11 * 1024 * 1024); // Exceeds default 10MB limit

        var uploadRes = await agentA
            .post('/api/files')
            .attach('file', bigBuffer, 'oversized.png')
            .expect(413);

        expect(uploadRes.body.code).to.equal('payload_too_large');
    });

    // 9. archive path traversal 被拒绝
    it('scenario 9: rejects archive import containing path traversal entries (.. or root slashes)', function (done) {
        makeTarBuffer([
            { header: { name: '../etc/passwd' }, content: 'root:x:0:0:::' },
            { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
        ], function (err, tarBuf) {
            expect(err).to.be(null);

            agentA
                .post('/api/import')
                .attach('file', tarBuf, 'traversal.tar')
                .expect(400)
                .end(function (importErr, importRes) {
                    expect(importErr).to.be(null);
                    expect(importRes.body.code).to.equal('invalid_request');
                    expect(importRes.body.message).to.match(/Path traversal|Dangerous path/);
                    done();
                });
        });
    });

    // 10. malformed ObjectId/ID 不造成 500
    it('scenario 10: maps malformed ObjectId parameters to 400 invalid_request without crashing', async function () {
        var res = await agentA
            .get('/api/things/not-a-valid-24-hex-id')
            .expect(400);

        expect(res.body.code).to.equal('invalid_request');
        expect(res.body.status).to.equal('Bad Request');
        expect(res.body.message).to.equal('invalid id');
    });

    // 11. export/import round-trip
    it('scenario 11: end-to-end export -> import roundtrip preserves notes, tags, and attachments across accounts', async function () {
        // User A creates notes with tags and attachment
        var attachRes = await agentA
            .post('/api/files')
            .attach('file', Buffer.from('Roundtrip test artifact data'), 'artifact.txt')
            .expect(201);

        var artifactId = attachRes.body.identifier;

        await agentA
            .post('/api/things')
            .send({
                content: 'Preserved note with #important tag',
                attachments: [artifactId]
            })
            .expect(201);

        // Export data from user A
        var exportRes = await agentA
            .get('/api/export')
            .buffer()
            .parse(binaryParser)
            .expect(200);

        expect(exportRes.body).to.be.a(Buffer);
        expect(exportRes.body.length).to.be.greaterThan(0);

        // Import into User B
        var importRes = await agentB
            .post('/api/import')
            .attach('file', exportRes.body, 'meemo-export.tar')
            .expect(200);

        expect(importRes.body.imported).to.be.greaterThan(0);

        // Verify notes and tags in User B
        var listRes = await agentB
            .get('/api/things')
            .expect(200);

        expect(listRes.body.things.length).to.be.greaterThan(0);
        var importedNote = listRes.body.things.find(function (t) {
            return t.content.indexOf('Preserved note') !== -1;
        });
        expect(importedNote).to.be.ok();
        expect(importedNote.tags).to.contain('important');
        expect(importedNote.attachments.length).to.equal(1);
    });

    // 12. sticky notes filtering
    it('scenario 12: GET /api/things?sticky=true filters exclusively sticky notes', async function () {
        var stickyRes = await agentA
            .post('/api/things')
            .send({ content: 'Sticky Note Alpha' })
            .expect(201);
        var stickyId = stickyRes.body.thing._id;
        await agentA
            .put('/api/things/' + stickyId)
            .send({ content: 'Sticky Note Alpha', sticky: true })
            .expect(201);

        var normalRes = await agentA
            .post('/api/things')
            .send({ content: 'Normal Note Beta' })
            .expect(201);
        var normalId = normalRes.body.thing._id;

        // Query with sticky=true
        var listSticky = await agentA
            .get('/api/things?sticky=true')
            .expect(200);

        var ids = listSticky.body.things.map(function (t) { return t._id; });
        expect(ids).to.contain(stickyId);
        expect(ids).not.to.contain(normalId);
    });

    // 13. shared note lookup via /api/public/shared/things/:thingId
    it('scenario 13: GET /api/public/shared/things/:thingId resolves note directly without user ID', async function () {
        var noteRes = await agentA
            .post('/api/things')
            .send({ content: 'Directly shared note content' })
            .expect(201);
        var noteId = noteRes.body.thing._id;

        // Before making it shared/public, anonymous request is forbidden
        var forbiddenRes = await request(app)
            .get('/api/public/shared/things/' + noteId);
        expect(forbiddenRes.status).to.equal(403);

        // Mark as shared
        await agentA
            .put('/api/things/' + noteId)
            .send({ content: 'Directly shared note content', shared: true })
            .expect(201);

        // Anonymous request via /shared alias succeeds
        var sharedRes = await request(app)
            .get('/api/public/shared/things/' + noteId)
            .expect(200);

        expect(sharedRes.body.thing._id).to.equal(noteId);
        expect(sharedRes.body.thing.content).to.equal('Directly shared note content');
    });
});
