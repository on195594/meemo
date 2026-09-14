'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var request = require('supertest');
var tarStream = require('tar-stream');
var config = require('../config.js');
var users = require('../users.js');
var logic = require('../services/import-export-service.js');
var storage = require('../storage/local-storage.js');
var tags = require('../database/tags.js');
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

var archiveSequence = 0;
function importEntries(userId, entries) {
    return new Promise(function (resolve, reject) {
        makeTarBuffer(entries, function (error, tarBuffer) {
            if (error) return reject(error);
            var archivePath = '/tmp/meemo-import-case-' + process.pid + '-' + (++archiveSequence) + '.tar';
            fs.writeFileSync(archivePath, tarBuffer);
            logic.importArchive(userId, archivePath, function (importError, result) {
                fs.rmSync(archivePath, { force: true });
                resolve({ error: importError, result: result });
            });
        });
    });
}

function streamToBuffer(stream) {
    return new Promise(function (resolve, reject) {
        var chunks = [];
        stream.on('data', function (chunk) { chunks.push(chunk); });
        stream.on('end', function () { resolve(Buffer.concat(chunks)); });
        stream.on('error', reject);
    });
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

            require('mongodb').MongoClient.connect(config.databaseUrl).then(function (client) {
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

        it('rejects attachment manifest mismatches before database writes', async function () {
            var cases = [
                {
                    message: 'missing referenced attachment',
                    entries: [{ header: { name: 'things.json' }, content: JSON.stringify({
                        things: [{ content: 'missing', attachments: [{ identifier: 'missing.txt' }] }]
                    }) }]
                },
                {
                    message: 'unreferenced attachment',
                    entries: [
                        { header: { name: 'attachments/orphan.txt' }, content: 'orphan' },
                        { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
                    ]
                },
                {
                    message: 'nested or unsupported attachment entry',
                    entries: [
                        { header: { name: 'attachments/nested/file.txt' }, content: 'nested' },
                        { header: { name: 'things.json' }, content: JSON.stringify({ things: [] }) }
                    ]
                },
                {
                    message: 'duplicate mapped attachment identifier',
                    entries: [
                        { header: { name: 'attachments/duplicate.txt' }, content: 'first' },
                        { header: { name: 'attachments/duplicate.txt' }, content: 'second' },
                        { header: { name: 'things.json' }, content: JSON.stringify({
                            things: [{ content: 'duplicate', attachments: [{ identifier: 'duplicate.txt' }] }]
                        }) }
                    ]
                }
            ];

            for (var testCase of cases) {
                var outcome = await importEntries(testUserId, testCase.entries);
                expect(outcome.error).to.be.ok();
                expect(outcome.error.message).to.contain(testCase.message);
            }
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(0);
        });
    });

    describe('Atomic rollback and successful import', function () {
        it('round-trips one shared attachment without exporting orphan storage files', async function () {
            var targetUserId = 'roundtrip-target';
            var sharedFile = 'shared-roundtrip.txt';
            var orphanFile = 'orphan-roundtrip.txt';
            var sourceFolder = path.join(testAttachmentDir, testUserId);
            var targetFolder = path.join(testAttachmentDir, targetUserId);
            var archivePath = '/tmp/meemo-roundtrip-' + process.pid + '.tar';
            var attachment = [{ identifier: sharedFile, fileName: sharedFile, type: 'text/plain' }];

            fs.mkdirSync(sourceFolder, { recursive: true });
            fs.writeFileSync(path.join(sourceFolder, sharedFile), 'shared content');
            fs.writeFileSync(path.join(sourceFolder, orphanFile), 'must not be exported');
            await things.insertFull(testUserId, 'shared one', [], attachment, [], 1, 1);
            await things.insertFull(testUserId, 'shared two', [], attachment, [], 2, 2);

            try {
                var stream = await logic.createExport(testUserId, testUserId);
                fs.writeFileSync(archivePath, await streamToBuffer(stream));
                var result = await logic.importArchive(targetUserId, archivePath);

                expect(result.imported).to.equal(2);
                expect(fs.readFileSync(path.join(targetFolder, sharedFile), 'utf8')).to.equal('shared content');
                expect(fs.existsSync(path.join(targetFolder, orphanFile))).to.be(false);
                var imported = await things.getUnifiedCollection().find({ ownerId: targetUserId }).toArray();
                expect(imported.length).to.equal(2);
                expect(imported.every(function (thing) {
                    return thing.attachments[0].identifier === sharedFile;
                })).to.be(true);
            } finally {
                fs.rmSync(archivePath, { force: true });
                fs.rmSync(sourceFolder, { recursive: true, force: true });
                fs.rmSync(targetFolder, { recursive: true, force: true });
                await things.getUnifiedCollection().deleteMany({ ownerId: { $in: [testUserId, targetUserId] } });
            }
        });

        it('fails before returning an export stream when referenced attachment is missing', async function () {
            var missingFile = 'missing-export.txt';
            await things.insertFull(testUserId, 'stale attachment metadata', [], [{ identifier: missingFile }], [], 1, 1);

            var error;
            try {
                await logic.createExport(testUserId, testUserId);
            } catch (caught) {
                error = caught;
            } finally {
                await things.getUnifiedCollection().deleteMany({ ownerId: testUserId });
            }

            expect(error).to.be.ok();
            expect(error.message).to.equal('Cannot export missing attachment: ' + missingFile);
        });

        it('returns success with a warning when temporary extraction cleanup fails after commit', async function () {
            var promiseFs = fs.promises;
            var originalRm = promiseFs.rm;
            var cleanupError = new Error('forced temporary cleanup failure after commit');
            var tempTarget;
            promiseFs.rm = function (target) {
                if (path.basename(target).indexOf('meemo-import-') === 0) {
                    tempTarget = target;
                    return Promise.reject(cleanupError);
                }
                return originalRm.apply(promiseFs, arguments);
            };

            var outcome;
            try {
                outcome = await importEntries(testUserId, [
                    { header: { name: 'things.json' }, content: JSON.stringify({ things: [{ content: 'committed temp cleanup' }] }) }
                ]);
            } finally {
                promiseFs.rm = originalRm;
                if (tempTarget) fs.rmSync(tempTarget, { recursive: true, force: true });
            }

            expect(outcome.error).to.be(null);
            expect(outcome.result.imported).to.equal(1);
            expect(outcome.result.cleanupWarnings.length).to.equal(1);
            expect(outcome.result.cleanupWarnings[0].operation).to.equal('remove temporary extraction directory');
            expect(outcome.result.cleanupWarnings[0].message).to.equal(cleanupError.message);
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(1);
            await things.getUnifiedCollection().deleteMany({ ownerId: testUserId });
        });

        it('returns success with a warning when uploaded archive deletion fails after commit', async function () {
            var archivePath = '/tmp/meemo-upload-cleanup-' + process.pid + '.tar';
            var cleanupError = new Error('forced uploaded archive cleanup failure after commit');
            var originalRemoveFile = storage.removeFile;
            var tarBuffer = await new Promise(function (resolve, reject) {
                makeTarBuffer([
                    { header: { name: 'things.json' }, content: JSON.stringify({ things: [{ content: 'committed upload cleanup' }] }) }
                ], function (error, buffer) { if (error) reject(error); else resolve(buffer); });
            });
            fs.writeFileSync(archivePath, tarBuffer);
            storage.removeFile = function () { return Promise.reject(cleanupError); };

            var result;
            try {
                result = await logic.importUploadedArchive(testUserId, archivePath);
            } finally {
                storage.removeFile = originalRemoveFile;
                fs.rmSync(archivePath, { force: true });
            }

            expect(result.imported).to.equal(1);
            expect(result.cleanupWarnings.length).to.equal(1);
            expect(result.cleanupWarnings[0].operation).to.equal('remove uploaded archive');
            expect(result.cleanupWarnings[0].message).to.equal(cleanupError.message);
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(1);
            await things.getUnifiedCollection().deleteMany({ ownerId: testUserId });
        });

        it('rejects attachment collisions without changing existing files or leaving residue', function (done) {
            var userFolder = path.join(testAttachmentDir, testUserId);
            var existingFile = 'z-existing-attachment.txt';
            var newFile = 'a-new-attachment.txt';
            var archivePath = '/tmp/meemo-import-collision-' + process.pid + '.tar';
            var targetFile = path.join(userFolder, existingFile);
            var newTargetFile = path.join(userFolder, newFile);
            var copiedIdentifiers = [];
            var originalCopyAttachment = storage.copyAttachment;
            var hash = function () {
                return crypto.createHash('sha256').update(fs.readFileSync(targetFile)).digest('hex');
            };

            fs.mkdirSync(userFolder, { recursive: true });
            fs.writeFileSync(targetFile, 'original attachment content');
            var originalHash = hash();

            makeTarBuffer([
                { header: { name: 'attachments/' + newFile }, content: 'must be rolled back' },
                { header: { name: 'attachments/' + existingFile }, content: 'must not overwrite' },
                { header: { name: 'things.json' }, content: JSON.stringify({
                    things: [{
                        content: 'Imported collision note',
                        attachments: [
                            { identifier: existingFile, fileName: existingFile, type: 'text/plain' },
                            { identifier: newFile, fileName: newFile, type: 'text/plain' }
                        ]
                    }]
                }) }
            ], function (err, tarBuf) {
                if (err) return done(err);
                fs.writeFileSync(archivePath, tarBuf);
                storage.copyAttachment = function (userId, sourcePath, identifier) {
                    copiedIdentifiers.push(identifier);
                    return originalCopyAttachment(userId, sourcePath, identifier);
                };

                logic.importArchive(testUserId, archivePath, function (err) {
                    storage.copyAttachment = originalCopyAttachment;
                    fs.rmSync(archivePath, { force: true });
                    try {
                        expect(err).to.be.ok();
                        expect(err.code).to.equal('EEXIST');
                        expect(copiedIdentifiers).to.eql([newFile, existingFile]);
                        expect(hash()).to.equal(originalHash);
                        expect(fs.existsSync(newTargetFile)).to.be(false);
                    } catch (assertionError) {
                        return done(assertionError);
                    }

                    things.getAll(testUserId, {}, 0, 10, function (err, result) {
                        if (err) return done(err);
                        expect(result.length).to.equal(0);
                        done();
                    });
                });
            });
        });

        it('tracks and removes an insert when its post-insert read fails', async function () {
            var originalGet = things.get;
            things.get = function () { return Promise.reject(new Error('forced post-insert read failure')); };
            var outcome;
            try {
                outcome = await new Promise(function (resolve) {
                    logic.importData(testUserId, { things: [{ content: 'post-read failure' }] }, function (error, result) {
                        resolve({ error: error, result: result });
                    });
                });
            } finally {
                things.get = originalGet;
            }

            expect(outcome.error).to.be.ok();
            expect(outcome.error.message).to.contain('forced post-insert read failure');
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(0);
        });

        it('does not mutate persisted tag projection when an import fails', async function () {
            var tagCollection = tags.getUnifiedCollection();
            await tags.update(testUserId, 'existing');
            await tagCollection.updateOne({ ownerId: testUserId, name: 'existing' }, {
                $set: { usage: 7, createdAt: 111, modifiedAt: 222, marker: 'preserve' }
            });
            var before = await tagCollection.findOne({ ownerId: testUserId, name: 'existing' });
            var originalInsertFull = things.insertFull;
            var insertCalls = 0;
            things.insertFull = function () {
                insertCalls++;
                if (insertCalls === 2) return Promise.reject(new Error('forced second insert failure'));
                return originalInsertFull.apply(things, arguments);
            };

            var outcome;
            try {
                outcome = await new Promise(function (resolve) {
                    logic.importData(testUserId, {
                        things: [
                            { content: 'first #existing #newtag' },
                            { content: 'second #existing #newtag' }
                        ]
                    }, function (error, result) {
                        resolve({ error: error, result: result });
                    });
                });
            } finally {
                things.insertFull = originalInsertFull;
            }

            var after = await tagCollection.findOne({ ownerId: testUserId, name: 'existing' });
            expect(outcome.error).to.be.ok();
            expect(JSON.stringify(after)).to.equal(JSON.stringify(before));
            expect(await tagCollection.findOne({ ownerId: testUserId, name: 'newtag' })).to.be(null);
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(0);
            await tagCollection.deleteMany({ ownerId: testUserId });
        });

        it('leaves independent tag projection writes untouched during import rollback', async function () {
            var tagCollection = tags.getUnifiedCollection();
            await tagCollection.insertOne({
                ownerId: testUserId,
                name: 'existing',
                usage: 7,
                createdAt: 111,
                modifiedAt: 222,
                marker: 'before'
            });
            var originalInsertFull = things.insertFull;
            var insertCalls = 0;
            things.insertFull = function () {
                insertCalls++;
                if (insertCalls !== 2) return originalInsertFull.apply(things, arguments);
                return Promise.all([
                    tagCollection.updateOne({ ownerId: testUserId, name: 'existing' }, {
                        $inc: { usage: 3 },
                        $set: { modifiedAt: 999999, marker: 'concurrent', concurrentField: 'keep' }
                    }),
                    tagCollection.updateOne({ ownerId: testUserId, name: 'newtag' }, {
                        $inc: { usage: 2 },
                        $set: { modifiedAt: 999999, marker: 'concurrent-new', concurrentField: 'keep-new' },
                        $setOnInsert: { createdAt: 999999 }
                    }, { upsert: true })
                ]).then(function () { throw new Error('forced failure after concurrent tag writes'); });
            };

            var outcome;
            try {
                outcome = await new Promise(function (resolve) {
                    logic.importData(testUserId, {
                        things: [
                            { content: 'first #existing #newtag' },
                            { content: 'second without tags' }
                        ]
                    }, function (error, result) { resolve({ error: error, result: result }); });
                });
            } finally {
                things.insertFull = originalInsertFull;
            }

            var existing = await tagCollection.findOne({ ownerId: testUserId, name: 'existing' });
            var newtag = await tagCollection.findOne({ ownerId: testUserId, name: 'newtag' });
            expect(outcome.error.message).to.contain('forced failure after concurrent tag writes');
            expect(existing.usage).to.equal(10);
            expect(existing.modifiedAt).to.equal(999999);
            expect(existing.marker).to.equal('concurrent');
            expect(existing.concurrentField).to.equal('keep');
            expect(newtag.usage).to.equal(2);
            expect(newtag.modifiedAt).to.equal(999999);
            expect(newtag.marker).to.equal('concurrent-new');
            expect(newtag.concurrentField).to.equal('keep-new');
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(0);
            await tagCollection.deleteMany({ ownerId: testUserId });
        });

        it('attempts every rollback and reports failures without replacing the primary error', async function () {
            var userFolder = path.join(testAttachmentDir, testUserId);
            var firstFile = 'a-rollback-fails.txt';
            var secondFile = 'b-rollback-succeeds.txt';
            var existingFile = 'z-primary-collision.txt';
            var firstTarget = path.join(userFolder, firstFile);
            var secondTarget = path.join(userFolder, secondFile);
            var existingTarget = path.join(userFolder, existingFile);
            fs.mkdirSync(userFolder, { recursive: true });
            fs.writeFileSync(existingTarget, 'preserve primary file');

            var primaryCause = new Error('collision cause');
            var primaryError = new Error('forced attachment collision');
            primaryError.code = 'EEXIST';
            primaryError.cause = primaryCause;
            var rollbackError = new Error('forced thing rollback failure');
            var fileRollbackError = new Error('forced file rollback failure');
            var tempCleanupError = new Error('forced temporary cleanup failure');
            var originalCopyAttachment = storage.copyAttachment;
            var originalDelete = things.del;
            var promiseFs = fs.promises;
            var originalRm = promiseFs.rm;
            var copiedIdentifiers = [];
            var deletedIds = [];
            var tempTarget;

            storage.copyAttachment = function (userId, sourcePath, identifier) {
                copiedIdentifiers.push(identifier);
                if (identifier === existingFile) return Promise.reject(primaryError);
                return originalCopyAttachment(userId, sourcePath, identifier);
            };
            things.del = function (userId, thingId) {
                deletedIds.push(thingId);
                if (deletedIds.length === 1) return Promise.reject(rollbackError);
                return originalDelete(userId, thingId);
            };
            promiseFs.rm = function (target) {
                if (target === firstTarget) return Promise.reject(fileRollbackError);
                if (path.basename(target).indexOf('meemo-import-') === 0) {
                    tempTarget = target;
                    return Promise.reject(tempCleanupError);
                }
                return originalRm.apply(promiseFs, arguments);
            };

            var outcome;
            try {
                outcome = await importEntries(testUserId, [
                    { header: { name: 'attachments/' + firstFile }, content: 'first' },
                    { header: { name: 'attachments/' + secondFile }, content: 'second' },
                    { header: { name: 'attachments/' + existingFile }, content: 'collision' },
                    { header: { name: 'things.json' }, content: JSON.stringify({
                        things: [
                            {
                                content: 'rollback one',
                                attachments: [
                                    { identifier: firstFile },
                                    { identifier: secondFile },
                                    { identifier: existingFile }
                                ]
                            },
                            { content: 'rollback two' }
                        ]
                    }) }
                ]);
            } finally {
                storage.copyAttachment = originalCopyAttachment;
                things.del = originalDelete;
                promiseFs.rm = originalRm;
                if (tempTarget) fs.rmSync(tempTarget, { recursive: true, force: true });
            }

            expect(outcome.error).to.equal(primaryError);
            expect(outcome.error.code).to.equal('EEXIST');
            expect(outcome.error.cause).to.equal(primaryCause);
            expect(outcome.error.message).to.contain('rollback/cleanup incomplete');
            expect(outcome.error.cleanupErrors.length).to.equal(3);
            expect(outcome.error.cleanupErrors.some(function (failure) {
                return failure.error === tempCleanupError;
            })).to.be(true);
            expect(deletedIds.length).to.equal(2);
            expect(copiedIdentifiers).to.eql([firstFile, secondFile, existingFile]);
            expect(fs.existsSync(firstTarget)).to.be(true);
            expect(fs.existsSync(secondTarget)).to.be(false);
            expect(fs.readFileSync(existingTarget, 'utf8')).to.equal('preserve primary file');
            expect(await things.getUnifiedCollection().countDocuments({ ownerId: testUserId })).to.equal(1);

            await things.getUnifiedCollection().deleteMany({ ownerId: testUserId });
            fs.rmSync(firstTarget, { force: true });
            fs.rmSync(existingTarget, { force: true });
        });

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
