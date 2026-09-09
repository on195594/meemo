'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var fs = require('fs');
var path = require('path');
var request = require('supertest');
var tarStream = require('tar-stream');
var config = require('../config.js');
var users = require('../users.js');
var logic = require('../logic.js');
var things = require('../database/things.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

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

describe('Import Safety and Consistency (RF-106)', function () {
    var app;
    var usersFilePath = '/tmp/meemo-import-test-' + process.pid + '.json';
    var prevUsersFile = process.env.USERS_FILE;
    var prevAttachmentDir = config.attachmentDir;
    var testAttachmentDir = '/tmp/meemo-import-storage-' + process.pid;
    var authAgent;
    var testUserId;

    before(function (done) {
        process.env.USERS_FILE = usersFilePath;
        config.attachmentDir = testAttachmentDir;

        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });

        config._clearDatabase(function (err) {
            if (err) return done(err);

            var MongoClient = require('mongodb').MongoClient;
            MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (err, client) {
                if (err) return done(err);
                config.db = client.db();
                app = createApp({ sessionMemory: true });

                users.create('importer', 'importer@example.com', 'Importer', 'Password123!', function (err) {
                    if (err) return done(err);

                    testUserId = 'importer';

                    authAgent = request.agent(app);
                    authAgent
                        .post('/api/login')
                        .send({ username: 'importer', password: 'Password123!' })
                        .expect(200, done);
                });
            });
        });
    });

    after(function (done) {
        process.env.USERS_FILE = prevUsersFile;
        config.attachmentDir = prevAttachmentDir;

        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        config._clearDatabase(done);
    });

    describe('Schema validation (validateThingsData)', function () {
        it('rejects null or non-object', function () {
            expect(logic.validateThingsData(null)).to.be.a('string');
            expect(logic.validateThingsData('string')).to.be.a('string');
            expect(logic.validateThingsData([])).to.be.a('string');
        });

        it('rejects missing things array', function () {
            expect(logic.validateThingsData({})).to.contain('must have a "things" array');
            expect(logic.validateThingsData({ things: 'not-array' })).to.contain('must have a "things" array');
        });

        it('rejects non-object thing entry', function () {
            expect(logic.validateThingsData({ things: ['string-thing'] })).to.contain('must be an object');
        });

        it('rejects thing missing string content', function () {
            expect(logic.validateThingsData({ things: [{}] })).to.contain('must have a string content');
            expect(logic.validateThingsData({ things: [{ content: 123 }] })).to.contain('must have a string content');
        });

        it('rejects path traversal in attachment identifiers', function () {
            var badData = {
                things: [{
                    content: 'test note',
                    attachments: [{ identifier: '../../etc/passwd', fileName: 'passwd', type: 'text/plain' }]
                }]
            };
            expect(logic.validateThingsData(badData)).to.contain('invalid attachment identifier');
        });

        it('accepts valid empty and non-empty things array', function () {
            expect(logic.validateThingsData({ things: [] })).to.be(null);
            expect(logic.validateThingsData({
                things: [{
                    content: '# Hello world',
                    createdAt: Date.now(),
                    modifiedAt: Date.now(),
                    attachments: [{ identifier: 'safe-file.png', fileName: 'safe-file.png', type: 'image/png' }]
                }]
            })).to.be(null);
        });
    });

    describe('Archive security and entry enforcement', function () {
        it('rejects archive with path traversal entry', function (done) {
            makeTarBuffer([
                { header: { name: '../evil.txt' }, content: 'evil content' },
                { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('Path traversal');
                        done();
                    });
            });
        });

        it('rejects archive with nested path traversal in attachments', function (done) {
            makeTarBuffer([
                { header: { name: 'attachments/../../evil.txt' }, content: 'evil content' },
                { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('Path traversal');
                        done();
                    });
            });
        });

        it('rejects archive with symlink entry', function (done) {
            makeTarBuffer([
                { header: { name: 'attachments/link', type: 'symlink', linkname: '/etc/passwd' }, content: '' },
                { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('Dangerous or unsupported entry type');
                        done();
                    });
            });
        });

        it('rejects archive missing things.json', function (done) {
            makeTarBuffer([
                { header: { name: 'attachments/hello.txt' }, content: 'hello' }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('missing things.json');
                        done();
                    });
            });
        });

        it('rejects archive with corrupted things.json', function (done) {
            makeTarBuffer([
                { header: { name: 'things.json' }, content: '{ invalid json' }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('not valid JSON');
                        done();
                    });
            });
        });

        it('rejects archive with invalid schema', function (done) {
            makeTarBuffer([
                { header: { name: 'things.json' }, content: JSON.stringify({ things: [{ content: 999 }] }) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.message).to.contain('Schema validation failed');
                        done();
                    });
            });
        });
    });

    describe('Atomic rollback and successful import', function () {
        it('rolls back database and file writes if import fails midway', function (done) {
            var userFolder = path.join(testAttachmentDir, testUserId);
            var orphanTestFile = 'orphan-candidate.txt';

            // Archive with 2 notes where second note content is invalid, plus an attachment
            var badData = {
                things: [
                    { content: 'Valid first note #tag1' },
                    { content: null } // Invalid content will fail midway
                ]
            };

            makeTarBuffer([
                { header: { name: 'attachments/' + orphanTestFile }, content: 'do not leak' },
                { header: { name: 'things.json' }, content: JSON.stringify(badData) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(400)
                    .end(function (err, res) {
                        if (err) return done(err);

                        // Verify that no attachment was left behind
                        var targetFile = path.join(userFolder, orphanTestFile);
                        expect(fs.existsSync(targetFile)).to.be(false);

                        // Verify that the first note was rolled back from database
                        things.getAll(testUserId, {}, 0, 10, function (err, result) {
                            if (err) return done(err);
                            expect(result.length).to.equal(0);
                            done();
                        });
                    });
            });
        });

        it('successfully imports notes and attachments and returns statistics', function (done) {
            var userFolder = path.join(testAttachmentDir, testUserId);
            var attachFile = 'test-doc.txt';

            var validData = {
                things: [
                    {
                        content: 'Imported Note 1 #imported',
                        createdAt: 1600000000000,
                        modifiedAt: 1600000001000,
                        attachments: [{ identifier: attachFile, fileName: attachFile, type: 'text/plain' }]
                    },
                    {
                        content: 'Imported Note 2 #second',
                        createdAt: 1600000002000,
                        modifiedAt: 1600000003000
                    }
                ]
            };

            makeTarBuffer([
                { header: { name: 'attachments/' + attachFile }, content: 'attachment content here' },
                { header: { name: 'things.json' }, content: JSON.stringify(validData) }
            ], function (err, tarBuf) {
                if (err) return done(err);

                authAgent
                    .post('/api/import')
                    .attach('file', tarBuf, 'import.tar')
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);

                        expect(res.body.total).to.equal(2);
                        expect(res.body.imported).to.equal(2);
                        expect(res.body.failed).to.equal(0);

                        // Verify attachment exists in storage
                        var targetFile = path.join(userFolder, attachFile);
                        expect(fs.existsSync(targetFile)).to.be(true);
                        expect(fs.readFileSync(targetFile, 'utf8')).to.equal('attachment content here');

                        // Verify notes exist in database
                        things.getAll(testUserId, {}, 0, 10, function (err, result) {
                            if (err) return done(err);
                            expect(result.length).to.equal(2);
                            done();
                        });
                    });
            });
        });
    });
});
