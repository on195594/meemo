'use strict';

/* global describe:false */
/* global it:false */
/* global afterEach:false */

var expect = require('expect.js'),
    childProcess = require('child_process'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient,
    verifier = require('../../scripts/verify-production-readiness.js');

function fakeDb(data) {
    return {
        collection: function (name) {
            return {
                find: function () {
                    return { toArray: function () { return Promise.resolve(data[name] || []); } };
                },
                countDocuments: function () {
                    return Promise.resolve((data[name] || []).length);
                }
            };
        }
    };
}

function validData() {
    return {
        users: [{
            _id: 'owner-a', username: 'owner-a', usernameNorm: 'owner-a', passwordHash: 'hash'
        }],
        things: [{
            _id: '000000000000000000000001', ownerId: 'owner-a',
            content: '#same #same #other', tags: ['same', 'same', 'other'],
            attachments: [{ identifier: 'file.bin' }]
        }],
        tags: [
            { ownerId: 'owner-a', name: 'same', usage: 2 },
            { ownerId: 'owner-a', name: 'other', usage: 1 }
        ],
        settings: [{ ownerId: 'owner-a', value: { title: 'ready' } }],
        sessions: []
    };
}

describe('Production business readiness verifier', function () {
    var tempDirs = [];

    afterEach(function () {
        tempDirs.forEach(function (dir) { fs.rmSync(dir, { recursive: true, force: true }); });
        tempDirs = [];
    });

    function attachmentRoot() {
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-readiness-'));
        tempDirs.push(root);
        fs.mkdirSync(path.join(root, 'owner-a'));
        fs.writeFileSync(path.join(root, 'owner-a', 'file.bin'), 'fixture');
        return root;
    }

    it('checks exact tags, owners, schemas, revoked sessions, and attachment resolution', async function () {
        var result = await verifier.inspectBusinessData(fakeDb(validData()), attachmentRoot());
        expect(result).to.eql({ users: 1, things: 1, tags: 2, settings: 1 });

        var cases = [
            { message: 'Session revocation', mutate: function (data) { data.sessions.push({ sid: 'old' }); } },
            { message: 'Thing owner or schema', mutate: function (data) { data.things[0].ownerId = 'other'; } },
            { message: 'Thing owner or schema', mutate: function (data) { data.things[0].tags.pop(); } },
            { message: 'Exact tag reconciliation', mutate: function (data) { data.tags[0].usage = 1; } },
            { message: 'Exact tag reconciliation', mutate: function (data) { data.tags.pop(); } },
            { message: 'Exact tag reconciliation', mutate: function (data) {
                data.tags.push({ ownerId: 'owner-a', name: 'stale', usage: 1 });
            } }
        ];
        for (var testCase of cases) {
            var data = validData();
            testCase.mutate(data);
            var error;
            try {
                await verifier.inspectBusinessData(fakeDb(data), attachmentRoot());
            } catch (caught) {
                error = caught;
            }
            expect(error).to.be.ok();
            expect(error.message).to.contain(testCase.message);
        }

        fs.rmSync(path.join(attachmentRoot(), 'owner-a', 'file.bin'));
        var attachmentError;
        try {
            await verifier.inspectBusinessData(fakeDb(validData()), tempDirs[tempDirs.length - 1]);
        } catch (caught) {
            attachmentError = caught;
        }
        expect(attachmentError).to.be.ok();
    });

    it('rejects a URI database mismatch before connecting and closes the client', async function () {
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-readiness-binding-'));
        tempDirs.push(root);
        var usersFile = path.join(root, 'users.json');
        var credentialsFile = path.join(root, 'credentials.json');
        var mongoUrl = 'mongodb://private-user:private-password@db.invalid/meemo-actual';
        fs.writeFileSync(usersFile, '{}', { mode: 0o600 });
        fs.writeFileSync(credentialsFile, JSON.stringify({
            username: 'private-user', password: 'private-password',
            mongoUrl: mongoUrl, thingId: '000000000000000000000001'
        }), { mode: 0o600 });

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
            await verifier.run({
                usersFile: usersFile,
                authUserSource: 'mongo',
                environment: 'production',
                expectedEnvironment: 'production',
                expectedDatabase: 'meemo-expected',
                expectedSourceFile: path.join(root, 'unused-source.json'),
                credentialsFile: credentialsFile,
                origin: 'https://meemo.invalid',
                attachmentDir: root
            });
        } catch (caught) {
            error = caught;
        } finally {
            MongoClient.prototype.connect = originalConnect;
            MongoClient.prototype.close = originalClose;
        }

        expect(error.message).to.equal('Environment or database binding failed');
        expect(error.message).not.to.contain(mongoUrl);
        expect(error.message).not.to.contain('private-password');
        expect(calls).to.eql(['close']);
    });

    it('prints only generic failure for rejected secret-bearing arguments', function () {
        var secret = 'mongodb://private-user:private-password@db.invalid/meemo';
        var result = childProcess.spawnSync(process.execPath, [
            path.resolve(__dirname, '../../scripts/verify-production-readiness.js'),
            '--mongo-url', secret
        ], { encoding: 'utf8' });
        expect(result.status).to.be(1);
        expect(result.stdout).to.equal('READINESS FAIL\n');
        expect(result.stderr).to.equal('');
        expect(result.stdout).not.to.contain(secret);
    });

    it('uses a restrictive credential file for real protected HTTP readback without returning secrets', async function () {
        var root = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-readback-'));
        tempDirs.push(root);
        var credentialsFile = path.join(root, 'credentials.json');
        var credentials = {
            username: 'private-user', password: 'private-password',
            mongoUrl: 'mongodb://private-db.invalid/meemo',
            thingId: '000000000000000000000001'
        };
        fs.writeFileSync(credentialsFile, JSON.stringify(credentials), { mode: 0o600 });
        expect(verifier.readCredentials(credentialsFile)).to.eql(credentials);
        fs.chmodSync(credentialsFile, 0o644);
        expect(function () { verifier.readCredentials(credentialsFile); }).to.throwError(/0600/);
        expect(function () {
            verifier.parseArgs(['--mongo-url', credentials.mongoUrl], {});
        }).to.throwError(/Unknown argument/);

        var routes = [];
        function response(body, cookie) {
            return Promise.resolve({
                ok: true,
                headers: { get: function (name) { return name === 'set-cookie' ? cookie : null; } },
                json: function () { return Promise.resolve(body); }
            });
        }
        var readbackResult = await verifier.authenticatedReadback({
            origin: 'https://meemo.invalid',
            fetch: function (url, options) {
                routes.push({ path: url.pathname, options: options || {} });
                if (url.pathname === '/api/login') return response({}, 'connect.sid=opaque; HttpOnly');
                if (url.pathname === '/api/profile') {
                    return response({ user: { id: 'opaque', username: credentials.username } });
                }
                if (url.pathname === '/api/logout') return response({});
                return response({ thing: { _id: credentials.thingId } });
            }
        }, credentials);

        expect(routes.map(function (entry) { return entry.path; })).to.eql([
            '/api/login', '/api/profile', '/api/things/' + credentials.thingId, '/api/logout'
        ]);
        expect(JSON.stringify(routes)).to.contain('private-password');
        expect(readbackResult).to.be(undefined);

        routes = [];
        var readbackError;
        try {
            await verifier.authenticatedReadback({
                origin: 'https://meemo.invalid',
                fetch: function (url) {
                    routes.push(url.pathname);
                    if (url.pathname === '/api/login') return response({}, 'connect.sid=opaque');
                    if (url.pathname === '/api/logout') return response({});
                    return response({});
                }
            }, credentials);
        } catch (caught) {
            readbackError = caught;
        }
        expect(readbackError).to.be.ok();
        expect(routes[routes.length - 1]).to.equal('/api/logout');
    });
});
