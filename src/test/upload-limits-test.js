'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var fs = require('fs');
var path = require('path');
var os = require('os');
var request = require('supertest');
var config = require('../config.js');
var users = require('../users.js');
var fileRoutes = require('../http/routes/files.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('Upload Limits and Storage Key Hardening (RF-105)', function () {
    var app;
    var usersFilePath = '/tmp/meemo-upload-test-' + process.pid + '.json';
    var prevUsersFile = process.env.USERS_FILE;
    var prevAttachmentDir = config.attachmentDir;
    var testAttachmentDir = '/tmp/meemo-upload-storage-' + process.pid;
    var authAgent;

    // Small limits for testing upload capping
    var prevMaxAttach = process.env.MAX_ATTACHMENT_SIZE;
    var prevMaxImport = process.env.MAX_IMPORT_SIZE;

    before(function (done) {
        process.env.USERS_FILE = usersFilePath;
        config.attachmentDir = testAttachmentDir;
        process.env.MAX_ATTACHMENT_SIZE = '1024'; // 1 KB limit for testing
        process.env.MAX_IMPORT_SIZE = '2048';     // 2 KB limit for testing

        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });

        config._clearDatabase(function (err) {
            if (err) return done(err);

            var MongoClient = require('mongodb').MongoClient;
            MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (err, client) {
                if (err) return done(err);
                config.db = client.db();
                app = createApp({ sessionMemory: true });

                users.create('uploader', 'uploader@example.com', 'Uploader', 'Password123!', function (err) {
                    if (err) return done(err);

                    authAgent = request.agent(app);
                    authAgent
                        .post('/api/login')
                        .send({ username: 'uploader', password: 'Password123!' })
                        .expect(200, done);
                });
            });
        });
    });

    after(function (done) {
        process.env.USERS_FILE = prevUsersFile;
        config.attachmentDir = prevAttachmentDir;
        if (prevMaxAttach === undefined) delete process.env.MAX_ATTACHMENT_SIZE;
        else process.env.MAX_ATTACHMENT_SIZE = prevMaxAttach;
        if (prevMaxImport === undefined) delete process.env.MAX_IMPORT_SIZE;
        else process.env.MAX_IMPORT_SIZE = prevMaxImport;

        fs.rmSync(usersFilePath, { force: true });
        fs.rmSync(testAttachmentDir, { recursive: true, force: true });
        config._clearDatabase(done);
    });

    describe('Image MIME and magic bytes verification', function () {
        it('detects valid PNG magic bytes', function () {
            var pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
            expect(fileRoutes.detectImageType(pngBuf)).to.equal('image/png');
        });

        it('detects valid JPEG magic bytes', function () {
            var jpegBuf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
            expect(fileRoutes.detectImageType(jpegBuf)).to.equal('image/jpeg');
        });

        it('detects valid GIF magic bytes', function () {
            var gifBuf = Buffer.from('GIF89a123456');
            expect(fileRoutes.detectImageType(gifBuf)).to.equal('image/gif');
        });

        it('detects valid WEBP magic bytes', function () {
            var webpBuf = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x00]);
            expect(fileRoutes.detectImageType(webpBuf)).to.equal('image/webp');
        });

        it('rejects spoofed images containing script or html', function () {
            var scriptBuf = Buffer.from('<script>alert("xss")</script>');
            expect(fileRoutes.detectImageType(scriptBuf)).to.be(null);

            var svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
            expect(fileRoutes.detectImageType(svgBuf)).to.be(null);
        });
    });

    describe('Attachment upload storage key and safe naming', function () {
        it('generates server-side opaque UUID storage key and does not use original filename in path', function (done) {
            var pngBuf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
            var maliciousFilename = '../../etc/passwd.png';

            authAgent
                .post('/api/files')
                .attach('file', pngBuf, maliciousFilename)
                .expect(201)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.type).to.equal('image');
                    // Identifier must be UUID-based
                    expect(res.body.identifier).to.match(/^[0-9a-f\-]{36}\.png$/i);
                    // Original filename sanitized for display
                    expect(res.body.fileName).to.equal('passwd.png');

                    // Check physical file on disk
                    var storedPath = path.join(testAttachmentDir, 'uploader', res.body.identifier);
                    expect(fs.existsSync(storedPath)).to.be(true);

                    // Ensure malicious filename does not exist
                    var badPath = path.join(testAttachmentDir, 'uploader', '..', '..', 'etc', 'passwd.png');
                    expect(fs.existsSync(badPath)).to.be(false);
                    done();
                });
        });

        it('marks non-image or spoofed mime uploads as type unknown and safe extension', function (done) {
            var fakeImageBuf = Buffer.from('this is not really an image file content');

            authAgent
                .post('/api/files')
                .attach('file', fakeImageBuf, { filename: 'malicious.jpg', contentType: 'image/jpeg' })
                .expect(201)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    // Magic byte mismatch: downgraded to unknown
                    expect(res.body.type).to.equal('unknown');
                    expect(res.body.identifier).to.match(/^[0-9a-f\-]{36}\.bin$/i);
                    expect(res.body.fileName).to.equal('malicious.jpg');
                    done();
                });
        });
    });

    describe('Upload limits enforcement', function () {
        var uploadRoutes = [
            { name: 'attachment', path: '/api/files' },
            { name: 'import', path: '/api/import' }
        ];

        function expectUploadError(pendingRequest, status, message, done) {
            pendingRequest
                .expect(status)
                .end(function (err, res) {
                    if (err) return done(err);
                    try {
                        expect(res.body.code).to.equal(status === 413 ? 'payload_too_large' : 'invalid_request');
                        expect(res.body.message).to.equal(message);
                        done();
                    } catch (assertionError) {
                        done(assertionError);
                    }
                });
        }

        it('returns 413 when attachment file exceeds size limit', function (done) {
            var oversizedBuffer = Buffer.alloc(2048, 'a');
            expectUploadError(
                authAgent.post('/api/files').attach('file', oversizedBuffer, 'oversized.txt'),
                413,
                'File too large',
                done
            );
        });

        it('returns 413 when import archive exceeds size limit', function (done) {
            var oversizedImport = Buffer.alloc(4096, 'x');
            expectUploadError(
                authAgent.post('/api/import').attach('file', oversizedImport, 'big-backup.tar'),
                413,
                'File too large',
                done
            );
        });

        it('configures an aggregate parts cap in addition to stricter file and field caps', function () {
            // files (1) + fields (10) is stricter than parts (12), so a valid
            // multipart body cannot reach LIMIT_PART_COUNT before another cap.
            var appSource = fs.readFileSync(path.resolve(__dirname, '../../app.js'), 'utf8');
            expect(appSource).to.contain('parts: 12');
        });

        uploadRoutes.forEach(function (route) {
            it('rejects too many files for ' + route.name + ' uploads', function (done) {
                expectUploadError(
                    authAgent.post(route.path)
                        .attach('file', Buffer.from('first'), 'first.txt')
                        .attach('file', Buffer.from('second'), 'second.txt'),
                    413,
                    'Too many files',
                    done
                );
            });

            it('rejects too many fields for ' + route.name + ' uploads', function (done) {
                var pendingRequest = authAgent.post(route.path);
                for (var i = 0; i < 11; i++) pendingRequest.field('field' + i, 'value');
                expectUploadError(pendingRequest, 400, 'Too many fields', done);
            });

            it('rejects large fields for ' + route.name + ' uploads', function (done) {
                expectUploadError(
                    authAgent.post(route.path).field('large', 'x'.repeat((1024 * 1024) + 1)),
                    400,
                    'Field value too long',
                    done
                );
            });

            it('rejects nested multipart fields for ' + route.name + ' uploads', function (done) {
                expectUploadError(
                    authAgent.post(route.path).field('metadata[nested]', 'value'),
                    400,
                    'Field name nesting too deep',
                    done
                );
            });

            it('returns a controlled error for malformed ' + route.name + ' multipart bodies', function (done) {
                var boundary = 'rf710-malformed-boundary';
                var body = '--' + boundary + '\r\n' +
                    'Content-Disposition: form-data; name="file"; filename="broken.txt"\r\n' +
                    'Content-Type: text/plain\r\n\r\n' +
                    'unterminated';
                expectUploadError(
                    authAgent.post(route.path)
                        .set('Content-Type', 'multipart/form-data; boundary=' + boundary)
                        .send(body),
                    400,
                    'Unexpected end of form',
                    done
                );
            });
        });
    });
});
