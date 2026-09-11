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
var users = require('../users.js');
var things = require('../database/things.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('Export and Import Round-Trip Safety Net (RF-107)', function () {
    var app;
    var usersFilePath = '/tmp/meemo-roundtrip-test-' + process.pid + '.json';
    var prevUsersFile = process.env.USERS_FILE;
    var prevAttachmentDir = config.attachmentDir;
    var testAttachmentDir = '/tmp/meemo-roundtrip-storage-' + process.pid;

    var exporterAgent;
    var importerAgent;
    var exportedTarBuffer;
    var uploadedAttachmentIdentifier;
    var exporterThingId;

    var binaryParser = function (res, cb) {
        var chunks = [];
        res.on('data', function (chunk) { chunks.push(chunk); });
        res.on('end', function () { cb(null, Buffer.concat(chunks)); });
        res.on('error', cb);
    };

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

                // Create exporter user
                users.create('exporter', 'exporter@example.com', 'Exporter User', 'Password123!', function (err) {
                    if (err) return done(err);

                    // Create importer user
                    users.create('importer', 'importer@example.com', 'Importer User', 'Password123!', function (err) {
                        if (err) return done(err);

                        exporterAgent = request.agent(app);
                        exporterAgent
                            .post('/api/login')
                            .send({ username: 'exporter', password: 'Password123!' })
                            .expect(200, function (err) {
                                if (err) return done(err);

                                importerAgent = request.agent(app);
                                importerAgent
                                    .post('/api/login')
                                    .send({ username: 'importer', password: 'Password123!' })
                                    .expect(200, done);
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

    it('step 1: populates source account with notes, tags, and attachment', function (done) {
        var sampleImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

        // Upload attachment
        exporterAgent
            .post('/api/files')
            .attach('file', sampleImage, 'screenshot.png')
            .expect(201)
            .end(function (err, res) {
                if (err) return done(err);

                expect(res.body.identifier).to.be.ok();
                uploadedAttachmentIdentifier = res.body.identifier;

                var note1Attachment = [{
                    identifier: uploadedAttachmentIdentifier,
                    fileName: 'screenshot.png',
                    type: 'image/png'
                }];

                // Create Note 1 with attachment and tags
                exporterAgent
                    .post('/api/things')
                    .send({
                        content: '# Project Roadmap\n\nSprint planning for Q3. #roadmap #planning',
                        attachments: note1Attachment
                    })
                    .expect(201)
                    .end(function (err, res) {
                        if (err) return done(err);
                        exporterThingId = res.body._id;

                        // Create Note 2 with multiple lines and tags
                        exporterAgent
                            .post('/api/things')
                            .send({
                                content: 'Reference documentation: https://example.com/docs #docs #planning'
                            })
                            .expect(201)
                            .end(function (err) {
                                if (err) return done(err);

                                // Create Note 3 with Unicode characters and code block
                                exporterAgent
                                    .post('/api/things')
                                    .send({
                                        content: 'Unicode test: 🚀 计划与架构\n```js\nconsole.log(42);\n```\n#unicode'
                                    })
                                    .expect(201, done);
                            });
                    });
            });
    });

    it('step 2: exports source account data into a valid tarball archive', function (done) {
        exporterAgent
            .get('/api/export')
            .buffer(true)
            .parse(binaryParser)
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);

                expect(res.header['content-disposition']).to.contain('meemo-export.tar');
                expect(Buffer.isBuffer(res.body)).to.be(true);
                expect(res.body.length).to.be.greaterThan(512); // Tar archives are in 512-byte blocks

                exportedTarBuffer = res.body;
                done();
            });
    });

    it('step 3: imports the tarball archive into empty destination account', function (done) {
        expect(exportedTarBuffer).to.be.ok();

        importerAgent
            .post('/api/import')
            .attach('file', exportedTarBuffer, 'exported-archive.tar')
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);

                expect(res.body.total).to.equal(3);
                expect(res.body.imported).to.equal(3);
                expect(res.body.failed).to.equal(0);
                done();
            });
    });

    it('step 4: verifies destination account notes and tags match source', function (done) {
        importerAgent
            .get('/api/things')
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);

                var notes = res.body.things;
                expect(notes).to.be.an('array');
                expect(notes.length).to.equal(3);

                var contents = notes.map(function (n) { return n.content; });

                var hasRoadmap = contents.some(function (c) { return c.indexOf('# Project Roadmap') !== -1; });
                var hasDocs = contents.some(function (c) { return c.indexOf('Reference documentation:') !== -1; });
                var hasUnicode = contents.some(function (c) { return c.indexOf('Unicode test: 🚀') !== -1; });

                expect(hasRoadmap).to.be(true);
                expect(hasDocs).to.be(true);
                expect(hasUnicode).to.be(true);

                // Verify tags were correctly extracted and indexed
                importerAgent
                    .get('/api/tags')
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);

                        var tags = res.body.tags;
                        expect(tags).to.be.an('array');
                        var tagNames = tags.map(function (t) { return t.name; });

                        expect(tagNames).to.contain('roadmap');
                        expect(tagNames).to.contain('planning');
                        expect(tagNames).to.contain('docs');
                        expect(tagNames).to.contain('unicode');

                        done();
                    });
            });
    });

    it('step 5: verifies imported attachment is accessible and bit-for-bit intact', function (done) {
        var importerFolder = path.join(testAttachmentDir, 'importer');
        var targetFile = path.join(importerFolder, uploadedAttachmentIdentifier);

        expect(fs.existsSync(targetFile)).to.be(true);
        var fileContent = fs.readFileSync(targetFile);
        var expectedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
        expect(fileContent.slice(0, 12).equals(expectedBytes)).to.be(true);

        // Retrieve importer's imported note containing the attachment
        importerAgent
            .get('/api/things')
            .expect(200)
            .end(function (err, res) {
                if (err) return done(err);

                var noteWithAttach = res.body.things.find(function (n) {
                    return n.attachments && n.attachments.length > 0;
                });
                expect(noteWithAttach).to.be.ok();

                // Access file via authenticated API
                importerAgent
                    .get('/api/files/importer/' + noteWithAttach._id + '/' + uploadedAttachmentIdentifier)
                    .buffer(true)
                    .parse(binaryParser)
                    .expect(200)
                    .end(function (err, res) {
                        if (err) return done(err);
                        expect(res.body.slice(0, 12).equals(expectedBytes)).to.be(true);
                        done();
                    });
            });
    });

    it('step 6: ensures export-import round-trip is repeatable across multiple instances', function (done) {
        users.create('repeat-user', 'repeat@example.com', 'Repeat User', 'Password123!', function (err) {
            if (err) return done(err);

            var repeatAgent = request.agent(app);
            repeatAgent
                .post('/api/login')
                .send({ username: 'repeat-user', password: 'Password123!' })
                .expect(200, function (err) {
                    if (err) return done(err);

                    repeatAgent
                        .post('/api/import')
                        .attach('file', exportedTarBuffer, 'exported-archive.tar')
                        .expect(200)
                        .end(function (err, res) {
                            if (err) return done(err);
                            expect(res.body.total).to.equal(3);
                            expect(res.body.imported).to.equal(3);

                            repeatAgent
                                .get('/api/things')
                                .expect(200)
                                .end(function (err, res) {
                                    if (err) return done(err);
                                    expect(res.body.things.length).to.equal(3);
                                    done();
                                });
                        });
                });
        });
    });
});
