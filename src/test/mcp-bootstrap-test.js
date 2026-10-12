'use strict';

/* global describe, it, beforeEach, afterEach */
var assert = require('assert'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    express = require('express'),
    request = require('supertest'),
    createMcp = require('../http/mcp.js').createMcp,
    authService = require('../services/mcp-auth-service.js');

var origin = 'https://bootstrap.example',
    callback = 'https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-synthetic-meemo';

function directories() {
    return fs.readdirSync(os.tmpdir()).filter(function (name) { return name.startsWith('meemo-mcp-bootstrap-'); });
}

function appFor(until) {
    var app = express();
    var mcp = createMcp({ mcp: { enabled: false, bootstrapUntil: until || new Date(Date.now() + 60000).toISOString(), publicUrl: origin, allowedOrigins: ['https://gemini.google.com'] } });
    app.use(mcp.protocol);
    app.use(mcp.browser);
    return app;
}

function call(app, method, url) {
    return request(app)[method](url).set('Host', 'bootstrap.example');
}

describe('MCP callback bootstrap (no authorization or note access)', function () {
    var existing;
    var previousProvider;
    beforeEach(function () {
        existing = directories();
        previousProvider = authService.createProvider;
        authService.createProvider = function () { throw new Error('Bootstrap must not initialize the authorization repository'); };
    });
    afterEach(function () {
        authService.createProvider = previousProvider;
        directories().filter(function (name) { return !existing.includes(name); }).forEach(function (name) {
            fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
        });
    });

    it('publishes bounded discovery/CORS and rejects every credential-bearing path', async function () {
        var app = appFor();
        var metadata = await call(app, 'get', '/.well-known/oauth-authorization-server').set('Origin', 'https://gemini.google.com').expect(200);
        assert.equal(metadata.body.registration_endpoint, origin + '/oauth/register');
        assert.equal(metadata.headers['access-control-allow-origin'], 'https://gemini.google.com');
        await call(app, 'get', '/.well-known/oauth-protected-resource/mcp').expect(200);
        var denied = await call(app, 'post', '/mcp').set('Authorization', 'Bearer synthetic-existing-token').send({ method: 'tools/list' }).expect(401);
        assert(denied.headers['www-authenticate'].includes('resource_metadata='));
        await call(app, 'get', '/mcp').expect(401);
        for (var endpoint of ['authorize', 'token', 'revoke']) await call(app, 'post', '/oauth/' + endpoint).expect(403);
        for (var endpoint2 of ['connections', 'request', 'consent']) await call(app, 'get', '/api/mcp/' + endpoint2).expect(404);
        await call(app, 'get', '/.well-known/oauth-authorization-server').set('Host', 'attacker.example').expect(403);
        await call(app, 'get', '/.well-known/oauth-authorization-server').set('Origin', 'https://attacker.example').expect(403);
    });

    it('captures only callbacks privately, rejects registration, and bounds retained entries', async function () {
        var app = appFor();
        for (var i = 0; i < 12; i++) {
            var response = await call(app, 'post', '/oauth/register').send({ redirect_uris: [callback + i], client_secret: 'synthetic-secret', client_name: 'synthetic-private-name' }).expect(400);
            assert(!response.body.client_id && !response.body.client_secret);
        }
        var directory = path.join(os.tmpdir(), directories().find(function (name) { return !existing.includes(name); }));
        var file = path.join(directory, 'callbacks.json');
        var text = fs.readFileSync(file, 'utf8');
        var snapshot = JSON.parse(text);
        assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
        assert.equal(fs.statSync(file).mode & 0o777, 0o600);
        assert.equal(snapshot.entries.length, 10);
        assert.equal(snapshot.entries[0].redirectUris[0], callback + '2');
        assert(!text.includes('synthetic-secret') && !text.includes('synthetic-private-name'));
    });

    it('does not persist arbitrary hosts, malformed bodies or callback secrets', async function () {
        var app = appFor();
        var invalid = [[], Array(11).fill(callback), ['https://attacker.example/r/user_bound_custom-mcp-meemo'], [callback + '?token=synthetic-secret'], [callback + '#secret'], ['http://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-meemo'], [callback + '/..'], ['x'.repeat(513)]];
        for (var uris of invalid) await call(app, 'post', '/oauth/register').send({ redirect_uris: uris }).expect(400);
        await call(app, 'post', '/oauth/register').set('Content-Type', 'application/json').send('{"client_secret":"synthetic-secret"').expect(400, { error: 'invalid_request' });
        await call(app, 'post', '/oauth/register').send({ oversized: 'x'.repeat(17000) }).expect(413);
        var directory = path.join(os.tmpdir(), directories().find(function (name) { return !existing.includes(name); }));
        assert(!fs.existsSync(path.join(directory, 'callbacks.json')));
    });

    it('expires discovery and removes the private capture without affecting ordinary routes', async function () {
        this.timeout(5000);
        var app = appFor(new Date(Date.now() + 600).toISOString());
        app.get('/ordinary', function (req, res) { res.sendStatus(200); });
        await call(app, 'post', '/oauth/register').send({ redirect_uris: [callback] }).expect(400);
        var directory = path.join(os.tmpdir(), directories().find(function (name) { return !existing.includes(name); }));
        await new Promise(function (resolve) { setTimeout(resolve, 850); });
        await call(app, 'get', '/.well-known/oauth-authorization-server').expect(404);
        await call(app, 'post', '/oauth/register').send({ redirect_uris: [callback] }).expect(404);
        await call(app, 'get', '/ordinary').expect(200);
        assert(!fs.existsSync(directory));
        await call(appFor(new Date(Date.now() - 1000).toISOString()), 'post', '/mcp').expect(404);
    });

    it('fails closed on incompatible or unbounded bootstrap configuration', function () {
        assert.throws(function () { appFor('invalid'); });
        assert.throws(function () { appFor(new Date(Date.now() + 31 * 60000).toISOString()); });
        assert.throws(function () { createMcp({ mcp: { enabled: true, bootstrapUntil: new Date(Date.now() + 60000).toISOString(), publicUrl: origin } }); });
    });
});
