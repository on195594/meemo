'use strict';

/* global describe, it, before, after */
var assert = require('assert'),
    crypto = require('crypto'),
    request = require('supertest'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    things = require('../database/things.js'),
    createApp = require('../http/app.js'),
    logger = require('../http/middleware/logger.js'),
    hash = require('../services/mcp-auth-service.js').hash;

var origin = 'https://meemo.example';
var callback = 'https://client.example/oauth/callback';
var resource = origin + '/mcp';

function protocol(app, method, path) { return request(app)[method](path).set('Host', 'meemo.example'); }
function challenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }

async function register(app, method) {
    var response = await protocol(app, 'post', '/oauth/register').send({
        redirect_uris: [callback], token_endpoint_auth_method: method || 'none', client_name: 'Synthetic Gemini', grant_types: ['authorization_code']
    }).expect(201);
    return response.body;
}

async function consent(app, agent, client, verifier, allow, scope) {
    var response = await protocol(app, 'get', '/oauth/authorize').query({
        client_id: client.client_id, redirect_uri: callback, response_type: 'code', resource: resource,
        scope: scope || 'notes.read notes.write', code_challenge: challenge(verifier), code_challenge_method: 'S256', state: 'synthetic-state'
    }).expect(302);
    var id = new URL(response.headers.location).searchParams.get('request');
    var info = await agent.get('/api/mcp/consent').query({ request: id }).expect(200);
    var decision = await agent.post('/api/mcp/consent').set('X-CSRF-Token', info.body.csrfToken).send({ request: id, allow: allow !== false }).expect(200);
    return { request: id, csrfToken: info.body.csrfToken, redirect: new URL(decision.body.redirectUrl) };
}

async function exchange(app, client, verifier, code, overrides) {
    return protocol(app, 'post', '/oauth/token').type('form').send(Object.assign({
        client_id: client.client_id, ...(client.client_secret ? { client_secret: client.client_secret } : {}),
        grant_type: 'authorization_code', code: code, code_verifier: verifier, redirect_uri: callback, resource: resource
    }, overrides));
}

async function connect(app, agent, client) {
    var verifier = crypto.randomBytes(32).toString('base64url');
    var result = await consent(app, agent, client, verifier);
    var token = await exchange(app, client, verifier, result.redirect.searchParams.get('code'));
    assert.equal(token.status, 200, JSON.stringify(token.body));
    return token.body.access_token;
}

function rpc(app, token, name, args) {
    return protocol(app, 'post', '/mcp').set('Authorization', 'Bearer ' + token)
        .set('Accept', 'application/json, text/event-stream').set('MCP-Protocol-Version', '2025-11-25')
        .send({ jsonrpc: '2.0', id: 1, method: name, ...(args ? { params: args } : {}) });
}
function toolBody(response) {
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert(response.body.result, JSON.stringify(response.body));
    return JSON.parse(response.body.result.content[0].text);
}

describe('MCP read/write tools and OAuth isolation', function () {
    this.timeout(20000);
    var dbClient, db, app, alice, bob, aliceId, bobId, client, aliceToken, bobToken, noteId, archivedId, otherId;
    var logs = [];

    before(async function () {
        await config._clearDatabase();
        dbClient = await MongoClient.connect(config.databaseUrl);
        db = dbClient.db();
        config.db = db;
        things.resetCache();
        await things.ensureIndexes();
        app = createApp({ sessionMemory: true, sessionSecret: 'synthetic-mcp-session',
            logger: logger.createLogger({ enabled: true, stream: function (entry) { logs.push(JSON.stringify(entry)); } }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        alice = request.agent(app);
        bob = request.agent(app);
        await require('../users.js').create('mcp_alice', 'alice@example.test', 'Synthetic Alice', 'SyntheticPassword123!');
        await require('../users.js').create('mcp_bob', 'bob@example.test', 'Synthetic Bob', 'SyntheticPassword123!');
        await alice.post('/api/login').send({ username: 'mcp_alice', password: 'SyntheticPassword123!' }).expect(200);
        await bob.post('/api/login').send({ username: 'mcp_bob', password: 'SyntheticPassword123!' }).expect(200);
        aliceId = (await alice.get('/api/profile').expect(200)).body.user.id;
        bobId = (await bob.get('/api/profile').expect(200)).body.user.id;
        var note = await things.insertFull(aliceId, 'private marker #alpha #beta', ['alpha', 'beta'], [{ identifier: 'private-attachment' }], [], 1, 1);
        noteId = note._id;
        var archived = await things.insertFull(aliceId, 'archived marker #gamma', ['gamma'], [], [], 2, 2);
        archivedId = archived._id;
        await things.put(aliceId, archivedId, archived.content, archived.tags, [], [], false, false, true, false, 'default', archived.revision);
        var other = await things.insertFull(bobId, 'other user secret #other', ['other'], [], [], 3, 3);
        otherId = other._id;
        client = await register(app);
        aliceToken = await connect(app, alice, client);
        bobToken = await connect(app, bob, client);
    });
    after(async function () {
        if (dbClient) { await config._clearDatabase(); await dbClient.close(); }
    });

    it('defaults to closed, validates configuration, and advertises resource-bound read/write OAuth', async function () {
        var disabled = createApp({ sessionMemory: true, sessionSecret: 'synthetic-disabled', mcp: { enabled: false } });
        await request(disabled).post('/mcp').expect(404);
        await request(disabled).get('/oauth/token').expect(404);
        await request(disabled).get('/api/mcp/connections').expect(404);
        await request(disabled).post('/api/mcp/consent').set('Content-Type', 'application/json').send('{invalid').expect(404);
        assert.throws(function () { createApp({ sessionMemory: true, mcp: { enabled: true, publicUrl: 'http://meemo.example', redirectUris: [callback] } }); });
        assert.throws(function () { createApp({ sessionMemory: true, mcp: { enabled: true, publicUrl: origin, redirectUris: ['https://client.example/*'] } }); });
        var metadata = await protocol(app, 'get', '/.well-known/oauth-protected-resource/mcp').expect(200);
        assert.equal(metadata.body.resource, resource);
        var oauth = await protocol(app, 'get', '/.well-known/oauth-authorization-server').expect(200);
        assert.deepEqual(oauth.body.grant_types_supported, ['authorization_code']);
        var unauthenticated = await protocol(app, 'post', '/mcp').expect(401);
        assert(unauthenticated.headers['www-authenticate'].includes('/.well-known/oauth-protected-resource/mcp'));
        await protocol(app, 'options', '/mcp').set('Origin', origin).expect(204);
        await protocol(app, 'post', '/mcp').set('Origin', 'https://attacker.example').expect(403);
        await request(app).post('/mcp').set('Host', 'attacker.example').expect(403);
    });

    it('registers six Google callback variants only when all are explicitly approved', async function () {
        var uris = ['oauth-redirect.googleusercontent.com', 'oauth-redirect-test.googleusercontent.com', 'oauth-redirect-sandbox.googleusercontent.com'].flatMap(function (host) {
            return ['r', 'a'].map(function (prefix) { return 'https://' + host + '/' + prefix + '/user_bound_custom-mcp-synthetic-meemo'; });
        });
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-six-callbacks', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: uris } });
        var response = await protocol(isolated, 'post', '/oauth/register').send({ redirect_uris: uris, token_endpoint_auth_method: 'none' }).expect(201);
        assert.deepEqual(response.body.redirect_uris, uris);
        await protocol(isolated, 'post', '/oauth/register').send({ redirect_uris: uris.concat(['https://attacker.example/callback']) }).expect(400);
    });

    it('registers bounded clients, stores only credential hashes and supports confidential clients', async function () {
        await protocol(app, 'post', '/oauth/register').send({ redirect_uris: ['https://attacker.example/callback'] }).expect(400);
        await protocol(app, 'post', '/oauth/register').send({ redirect_uris: [callback], client_uri: 'http://127.0.0.1' }).expect(400);
        await protocol(app, 'post', '/oauth/register').send({ redirect_uris: [callback], scope: 'notes.update' }).expect(400);
        var confidential = await register(app, 'client_secret_post');
        assert(confidential.client_secret);
        var stored = await db.collection('mcp_clients').findOne({ _id: confidential.client_id });
        assert.equal(stored.info.client_secret, hash(confidential.client_secret));
        var token = await connect(app, alice, confidential);
        assert(await db.collection('mcp_tokens').findOne({ _id: hash(token) }));
        assert.equal(await db.collection('mcp_tokens').findOne({ _id: token }), null);
    });

    it('enforces PKCE, resource, redirect binding and single-use codes', async function () {
        var verifier = crypto.randomBytes(32).toString('base64url');
        var approved = await consent(app, alice, client, verifier);
        assert.equal(approved.redirect.searchParams.get('state'), 'synthetic-state');
        var code = approved.redirect.searchParams.get('code');
        assert.equal((await exchange(app, client, 'a'.repeat(43), code)).status, 400);
        assert.equal((await exchange(app, client, verifier, code, { resource: 'https://attacker.example/mcp' })).status, 400);
        assert.equal((await exchange(app, client, verifier, code, { redirect_uri: 'https://attacker.example/callback' })).status, 400);
        var tokens = await Promise.all([exchange(app, client, verifier, code), exchange(app, client, verifier, code)]);
        assert.deepEqual(tokens.map(function (response) { return response.status; }).sort(), [200, 400]);
        assert.equal((await exchange(app, client, verifier, code)).status, 400);
        var expired = await consent(app, alice, client, verifier);
        var expiredCode = expired.redirect.searchParams.get('code');
        await db.collection('mcp_codes').updateOne({ _id: hash(expiredCode) }, { $set: { expiresAt: new Date(0) } });
        assert.equal((await exchange(app, client, verifier, expiredCode)).status, 400);
        var denied = await consent(app, alice, client, verifier, false);
        assert.equal(denied.redirect.searchParams.get('error'), 'access_denied');
        assert.equal(denied.redirect.searchParams.get('code'), null);
        await alice.post('/api/mcp/consent').set('X-CSRF-Token', denied.csrfToken).send({ request: denied.request, allow: true }).expect(400);
    });

    it('preserves long opaque OAuth state through consent and rejects state beyond 4096 characters', async function () {
        var verifier = crypto.randomBytes(32).toString('base64url');
        var params = {
            client_id: client.client_id, redirect_uri: callback, response_type: 'code', resource: resource,
            scope: 'notes.read', code_challenge: challenge(verifier), code_challenge_method: 'S256'
        };
        for (var length of [1001, 4096]) {
            var state = 'opaque+/=?&%'.repeat(400).slice(0, length);
            var response = await protocol(app, 'get', '/oauth/authorize').query(Object.assign({}, params, { state: state })).expect(302);
            var location = new URL(response.headers.location);
            assert.equal(location.origin + location.pathname, origin + '/assistant/authorize');
            var id = location.searchParams.get('request');
            var info = await alice.get('/api/mcp/consent').query({ request: id }).expect(200);
            var decision = await alice.post('/api/mcp/consent').set('X-CSRF-Token', info.body.csrfToken).send({ request: id, allow: true }).expect(200);
            var redirect = new URL(decision.body.redirectUrl);
            assert.equal(redirect.searchParams.get('state'), state);
            assert.equal((await exchange(app, client, verifier, redirect.searchParams.get('code'))).status, 200);
        }
        var pending = await db.collection('mcp_requests').countDocuments({ clientId: client.client_id });
        var rejected = await protocol(app, 'get', '/oauth/authorize').query(Object.assign({}, params, { state: 'x'.repeat(4097) })).expect(302);
        var error = new URL(rejected.headers.location);
        assert.equal(error.origin + error.pathname, callback);
        assert.equal(error.searchParams.get('error'), 'invalid_request');
        assert.equal(error.searchParams.get('error_description'), 'State too long');
        assert.equal(await db.collection('mcp_requests').countDocuments({ clientId: client.client_id }), pending);
    });

    it('requires login, explicit consent and CSRF; pending requests cannot cross users', async function () {
        var verifier = crypto.randomBytes(32).toString('base64url');
        var response = await protocol(app, 'get', '/oauth/authorize').query({
            client_id: client.client_id, redirect_uri: callback, response_type: 'code', resource: resource,
            code_challenge: challenge(verifier), code_challenge_method: 'S256'
        }).expect(302);
        var id = new URL(response.headers.location).searchParams.get('request');
        await request(app).get('/api/mcp/consent').query({ request: id }).expect(401);
        var info = await alice.get('/api/mcp/consent').query({ request: id }).expect(200);
        await bob.get('/api/mcp/consent').query({ request: id }).expect(400);
        await alice.post('/api/mcp/consent').set('X-CSRF-Token', info.body.csrfToken).send({ request: id, allow: true, padding: 'x'.repeat(2200) }).expect(413);
        await alice.post('/api/mcp/consent').send({ request: id, allow: true }).expect(403);
        await alice.post('/api/mcp/consent').set('X-CSRF-Token', info.body.csrfToken).set('Origin', 'https://attacker.example').send({ request: id, allow: true }).expect(403);
        await alice.post('/api/mcp/consent').set('X-CSRF-Token', info.body.csrfToken).send({ request: id, allow: false }).expect(200);
    });

    it('exposes note tools and isolates notes, tags and archived/deleted states', async function () {
        var initialized = await rpc(app, aliceToken, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' } });
        assert.equal(initialized.status, 200);
        var listed = await rpc(app, aliceToken, 'tools/list');
        var readTools = listed.body.result.tools.filter(function (t) { return t.annotations.readOnlyHint; }).map(function (t) { return t.name; }).sort();
        var writeTools = listed.body.result.tools.filter(function (t) { return !t.annotations.readOnlyHint; }).map(function (t) { return t.name; }).sort();
        assert.deepEqual(readTools, ['get_note', 'list_tags', 'search_notes']);
        assert.deepEqual(writeTools, ['create_note', 'delete_note', 'update_note']);
        var search = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'marker' } }));
        assert.deepEqual(search.notes.map(function (note) { return note.id; }), [noteId]);
        assert.equal(search.notes[0].content, undefined);
        var full = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: noteId } }));
        assert.deepEqual(Object.keys(full).sort(), ['content', 'id', 'revision']);
        assert.equal(full.content, 'private marker #alpha #beta');
        assert.equal(toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: otherId } })).code, 'not_found');
        assert.equal(toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: archivedId } })).id, archivedId);
        await protocol(app, 'get', '/api/things').set('Authorization', 'Bearer ' + aliceToken).expect(401);
        var tags = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'list_tags', arguments: { limit: 1 } }));
        assert.equal(tags.tags.length, 1);
        assert.equal(tags.hasMore, true);
        assert(!tags.tags.some(function (tag) { return tag.name === 'other'; }));
        assert.equal((await things.getTagUsage(aliceId)).length, 3);
        var deleted = await things.insertFull(aliceId, 'deleted secret', ['deleted'], [], [], 4, 4);
        await things.del(aliceId, deleted._id, deleted.revision);
        assert.equal(toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: deleted._id } })).code, 'not_found');
    });

    it('creates, updates with revision check, and deletes notes via MCP tools', async function () {
        // Verify token with only notes.read cannot call write tools
        var readOnlyVerifier = crypto.randomBytes(32).toString('base64url');
        var readOnlyConsent = await consent(app, alice, client, readOnlyVerifier, true, 'notes.read');
        var readOnlyTokenRes = await exchange(app, client, readOnlyVerifier, readOnlyConsent.redirect.searchParams.get('code'));
        var readOnlyToken = readOnlyTokenRes.body.access_token;
        var scopeDenied = toolBody(await rpc(app, readOnlyToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'forbidden write' }
        }));
        assert.equal(scopeDenied.code, 'insufficient_scope');

        // 1. create_note
        var created = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'mcp created note #newtag', color: 'sage' }
        }));
        assert(created.id);
        assert.equal(created.revision, 1);
        assert.equal(created.content, undefined);

        // Verify Bob cannot read it
        assert.equal(toolBody(await rpc(app, bobToken, 'tools/call', { name: 'get_note', arguments: { id: created.id } })).code, 'not_found');

        // Verify tags updated
        var tags = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'list_tags', arguments: {} }));
        assert(tags.tags.some(function (t) { return t.name === 'newtag'; }));

        // 2. update_note with revision conflict
        var conflict = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: created.id, expectedRevision: 999, content: 'conflict content' }
        }));
        assert.equal(conflict.code, 'revision_conflict');

        // 3. update_note success
        var updated = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: created.id, expectedRevision: 1, content: 'mcp updated content #updated' }
        }));
        assert.equal(updated.id, created.id);
        assert.equal(updated.revision, 2);
        assert.equal(updated.content, undefined);

        // Verify reading back shows updated content
        var readBack = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: created.id } }));
        assert.equal(readBack.content, 'mcp updated content #updated');
        assert.equal(readBack.revision, 2);

        // 4. delete_note with revision conflict
        var deleteConflict = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'delete_note', arguments: { id: created.id, expectedRevision: 1 }
        }));
        assert.equal(deleteConflict.code, 'revision_conflict');

        // 5. delete_note success
        var deleted = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'delete_note', arguments: { id: created.id, expectedRevision: 2 }
        }));
        assert.equal(deleted.id, created.id);
        assert.equal(deleted.deleted, true);

        // Verify get_note now returns not_found
        assert.equal(toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: created.id } })).code, 'not_found');

        // Reject modifying or deleting public or shared notes
        var publicId = new ObjectId();
        await db.collection('things').insertOne({
            _id: publicId, ownerId: aliceId, content: 'public note', tags: [],
            attachments: [], createdAt: 1, modifiedAt: 1, revision: 1, public: true, shared: false
        });
        var sharedId = new ObjectId();
        await db.collection('things').insertOne({
            _id: sharedId, ownerId: aliceId, content: 'shared note', tags: [],
            attachments: [], createdAt: 1, modifiedAt: 1, revision: 1, public: false, shared: true
        });

        var pubUpdate = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: publicId.toHexString(), expectedRevision: 1, content: 'tampered public' }
        }));
        assert.equal(pubUpdate.code, 'not_allowed');

        var sharedUpdate = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: sharedId.toHexString(), expectedRevision: 1, content: 'tampered shared' }
        }));
        assert.equal(sharedUpdate.code, 'not_allowed');

        var pubDelete = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'delete_note', arguments: { id: publicId.toHexString(), expectedRevision: 1 }
        }));
        assert.equal(pubDelete.code, 'not_allowed');

        var sharedDelete = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'delete_note', arguments: { id: sharedId.toHexString(), expectedRevision: 1 }
        }));
        assert.equal(sharedDelete.code, 'not_allowed');
    });

    it('restricts legacy grants without stored scopes to read-only access', async function () {
        var db = config.db;
        var legacyGrantId = 'legacy-grant-' + Date.now();
        await db.collection('mcp_grants').insertOne({
            _id: legacyGrantId, userId: aliceId, clientId: client.client_id, clientName: 'Legacy Client',
            createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000)
        });
        var legacyToken = 'legacy-token-' + Date.now();
        await db.collection('mcp_tokens').insertOne({
            _id: hash(legacyToken), clientId: client.client_id, grantId: legacyGrantId,
            expiresAt: new Date(Date.now() + 86400000)
        });
        // Can read
        var readRes = toolBody(await rpc(app, legacyToken, 'tools/call', { name: 'get_note', arguments: { id: noteId } }));
        assert.equal(readRes.content, 'private marker #alpha #beta');
        // Cannot write
        var writeRes = toolBody(await rpc(app, legacyToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'legacy write attempt' }
        }));
        assert.equal(writeRes.code, 'insufficient_scope');
    });

    it('bounds summaries, full responses, input and page depth without silently truncating notes', async function () {
        var large = await things.insertFull(aliceId, 'large'.repeat(40000), [], [], [], 5, 5);
        var response = await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: large._id } });
        assert.equal(response.body.result.isError, true);
        assert.equal(toolBody(response).code, 'result_too_large');
        var search = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'large', mode: 'regex' } }));
        assert(search.notes[0].summary.length <= 300);
        var textSearch = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'marker', mode: 'text' } }));
        assert.equal(textSearch.notes[0].id, noteId);
        var invalid = await rpc(app, aliceToken, 'tools/call', { name: 'search_notes', arguments: { skip: 1001 } });
        assert(invalid.body.result.isError || invalid.body.error);
        await protocol(app, 'post', '/mcp').set('Authorization', 'Bearer ' + aliceToken).send({ huge: 'x'.repeat(66000) }).expect(413);
        var logText = logs.join('');
        [aliceToken, bobToken, 'private marker', 'other user secret', 'SyntheticPassword123!'].forEach(function (secret) { assert(!logText.includes(secret)); });
    });

    it('does not leak concurrency slots when clients disconnect during authentication', async function () {
        var repository = require('../users.js').getRepository();
        var originalGet = repository.get;
        var entered, closed, release, pending;
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-disconnects', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var harness = require('express')();
        harness.use(function (req, res, next) { res.once('close', function () { closed(); }); next(); });
        harness.use(isolated);
        var server = await new Promise(function (resolve) {
            var listening = harness.listen(0, '127.0.0.1', function () { resolve(listening); });
        });
        repository.get = async function (id) {
            var user = await originalGet.apply(this, arguments);
            if (id !== aliceId) return user;
            return new Promise(function (resolve) { release = function () { resolve(user); }; entered(); });
        };
        try {
            for (var i = 0; i < 17; i++) {
                var authenticating = new Promise(function (resolve) { entered = resolve; });
                var disconnected = new Promise(function (resolve) { closed = resolve; });
                pending = require('http').request({ host: '127.0.0.1', port: server.address().port, path: '/mcp', method: 'POST', headers: {
                    Host: 'meemo.example', Authorization: 'Bearer ' + aliceToken, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'
                } });
                pending.on('error', function () {});
                pending.end(JSON.stringify({ jsonrpc: '2.0', id: i, method: 'tools/list' }));
                await authenticating;
                pending.destroy();
                await disconnected;
                release();
                await new Promise(setImmediate);
            }
            repository.get = originalGet;
            assert.equal((await rpc(isolated, aliceToken, 'tools/list')).status, 200);
        } finally {
            repository.get = originalGet;
            if (release) release();
            if (pending) pending.destroy();
            await new Promise(function (resolve) { server.close(resolve); });
        }
    });

    it('rejects batch calls and over-budget IDs before dispatching tools', async function () {
        var beforeCount = logs.filter(function (line) { return line.includes('"event":"mcp_tool"'); }).length;
        var message = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_note', arguments: { id: noteId } } };
        var batch = await protocol(app, 'post', '/mcp').set('Authorization', 'Bearer ' + aliceToken).set('Accept', 'application/json, text/event-stream')
            .send([message, Object.assign({}, message, { id: 2 })]).expect(400);
        assert.equal(batch.body.error.code, -32600);
        for (var id of ['x'.repeat(8192), '"'.repeat(128), '旅'.repeat(85)]) {
            var rejected = await protocol(app, 'post', '/mcp').set('Authorization', 'Bearer ' + aliceToken).set('Accept', 'application/json, text/event-stream')
                .send(Object.assign({}, message, { id: id })).expect(400);
            assert.equal(rejected.body.id, null);
        }
        assert.equal(logs.filter(function (line) { return line.includes('"event":"mcp_tool"'); }).length, beforeCount);
        var large = await things.insertFull(aliceId, 'x'.repeat(125 * 1024), [], [], [], 6, 6);
        var accepted = await protocol(app, 'post', '/mcp').set('Authorization', 'Bearer ' + aliceToken).set('Accept', 'application/json, text/event-stream')
            .send(Object.assign({}, message, { id: '"'.repeat(127), params: { name: 'get_note', arguments: { id: large._id } } })).expect(200);
        assert.equal(accepted.body.result.isError, undefined);
        assert(Buffer.byteLength(accepted.text) <= 128 * 1024);
    });

    it('provides bounded CORS for discovery, preflight and unauthenticated/error responses', async function () {
        var clientOrigin = 'https://gemini.google.com';
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-cors', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback], allowedOrigins: [clientOrigin] } });
        for (var path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-authorization-server']) {
            var metadata = await protocol(isolated, 'get', path).set('Origin', clientOrigin).expect(200);
            assert.equal(metadata.headers['access-control-allow-origin'], clientOrigin);
            await protocol(isolated, 'options', path).set('Origin', clientOrigin).set('Access-Control-Request-Method', 'GET').expect(204);
        }
        var unauthorized = await protocol(isolated, 'post', '/mcp').set('Origin', clientOrigin).expect(401);
        assert.equal(unauthorized.headers['access-control-allow-origin'], clientOrigin);
        assert(unauthorized.headers['access-control-expose-headers'].includes('WWW-Authenticate'));
        assert.equal(unauthorized.headers['access-control-allow-credentials'], undefined);
        var preflight = await protocol(isolated, 'options', '/oauth/token').set('Origin', clientOrigin).set('Access-Control-Request-Method', 'POST').expect(204);
        assert(preflight.headers['access-control-allow-headers'].includes('Authorization'));
        var invalid = await protocol(isolated, 'post', '/mcp').set('Origin', clientOrigin).set('Authorization', 'Bearer ' + aliceToken).send([]).expect(400);
        assert.equal(invalid.headers['access-control-allow-origin'], clientOrigin);
        var denied = await protocol(isolated, 'get', '/.well-known/oauth-protected-resource/mcp').set('Origin', 'https://attacker.example').expect(403);
        assert.equal(denied.headers['access-control-allow-origin'], undefined);
    });

    it('closes a stalled body at the absolute protocol deadline', async function () {
        var http = require('http');
        var server = await new Promise(function (resolve) {
            var listening = app.listen(0, '127.0.0.1', function () { resolve(listening); });
        });
        var started = Date.now();
        try {
            var error = await new Promise(function (resolve, reject) {
                var pending = http.request({ host: '127.0.0.1', port: server.address().port, path: '/mcp', method: 'POST', headers: {
                    Host: 'meemo.example', Authorization: 'Bearer ' + aliceToken, 'Content-Type': 'application/json', 'Content-Length': '1000'
                } });
                pending.setTimeout(18000, function () { pending.destroy(new Error('Server deadline did not close request')); });
                pending.on('error', resolve);
                pending.on('response', function (response) { response.resume(); reject(new Error('Expected deadline socket close, not response')); });
                pending.write('{');
            });
            assert.equal(error.code, 'ECONNRESET');
            assert(Date.now() - started >= 14000 && Date.now() - started < 18000);
        } finally {
            await new Promise(function (resolve) { server.close(resolve); });
        }
    });

    it('revokes only the signed-in user grant, including two users of the same client', async function () {
        var list = await alice.get('/api/mcp/connections').expect(200);
        var grant = list.body.connections.find(function (connection) { return connection.clientName === 'Synthetic Gemini'; });
        var record = await db.collection('mcp_tokens').findOne({ _id: hash(aliceToken) });
        assert(record);
        await bob.delete('/api/mcp/connections/' + record.grantId).set('X-CSRF-Token', (await bob.get('/api/mcp/connections')).body.csrfToken).expect(204);
        assert.equal((await rpc(app, aliceToken, 'tools/list')).status, 200);
        await alice.delete('/api/mcp/connections/' + record.grantId).expect(403);
        await alice.delete('/api/mcp/connections/' + record.grantId).set('X-CSRF-Token', list.body.csrfToken).expect(204);
        assert.equal((await rpc(app, aliceToken, 'tools/list')).status, 401);
        assert.equal((await rpc(app, bobToken, 'tools/list')).status, 200);
        assert(grant);
    });

    it('rejects refresh grants and supports token-only revocation without disabling its client', async function () {
        await protocol(app, 'post', '/oauth/token').type('form').send({ client_id: client.client_id, grant_type: 'refresh_token', refresh_token: 'synthetic' }).expect(400);
        var token = await connect(app, bob, client);
        await protocol(app, 'post', '/oauth/revoke').type('form').send({ client_id: client.client_id, token: token }).expect(200);
        assert.equal((await rpc(app, token, 'tools/list')).status, 401);
        assert.equal((await rpc(app, bobToken, 'tools/list')).status, 200);
    });

    it('limits public discovery requests independently of authentication', async function () {
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-limits', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        for (var i = 0; i < 120; i++) await protocol(isolated, 'get', '/.well-known/oauth-protected-resource/mcp').expect(200);
        await protocol(isolated, 'get', '/.well-known/oauth-protected-resource/mcp').expect(429);
    });

    it('rejects username-only legacy sessions instead of inferring a grant identity', async function () {
        var store = new (require('express-session').MemoryStore)();
        var isolated = createApp({ sessionStore: store, sessionSecret: 'synthetic-legacy-session', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var agent = request.agent(isolated);
        var login = await agent.post('/api/login').send({ username: 'mcp_alice', password: 'SyntheticPassword123!' }).expect(200);
        var cookie = decodeURIComponent(login.headers['set-cookie'][0].match(/^connect\.sid=([^;]+)/)[1]);
        var sid = cookie.slice(2).split('.')[0];
        var stored = await new Promise(function (resolve, reject) { store.get(sid, function (error, value) { if (error) reject(error); else resolve(value); }); });
        delete stored.userId;
        await new Promise(function (resolve, reject) { store.set(sid, stored, function (error) { if (error) reject(error); else resolve(); }); });
        await agent.get('/api/mcp/connections').expect(401);
    });

    it('rejects expired tokens/grants and removed users before Mongo TTL cleanup', async function () {
        var token = await connect(app, bob, client);
        await db.collection('mcp_tokens').updateOne({ _id: hash(token) }, { $set: { expiresAt: new Date(0) } });
        assert.equal((await rpc(app, token, 'tools/list')).status, 401);
        var token2 = await connect(app, bob, client);
        var record = await db.collection('mcp_tokens').findOne({ _id: hash(token2) });
        await db.collection('mcp_grants').updateOne({ _id: record.grantId }, { $set: { expiresAt: new Date(0) } });
        assert.equal((await rpc(app, token2, 'tools/list')).status, 401);
        await db.collection('users').updateOne({ _id: new ObjectId(bobId) }, { $set: { status: 'disabled' } });
        assert.equal((await rpc(app, bobToken, 'tools/list')).status, 401);
        await bob.get('/api/mcp/connections').expect(401);
        await db.collection('users').updateOne({ _id: new ObjectId(bobId) }, { $set: { status: 'active' } });
        // Simulate a deleted identity without modifying the real user repository.
        var valid = await connect(app, bob, client);
        var validRecord = await db.collection('mcp_tokens').findOne({ _id: hash(valid) });
        await db.collection('mcp_grants').updateOne({ _id: validRecord.grantId }, { $set: { userId: 'synthetic-removed-user' } });
        assert.equal((await rpc(app, valid, 'tools/list')).status, 401);
        // A username matching an old stable ID must not resurrect that user's token.
        await require('../users.js').create(bobId, 'collision@example.test', 'Synthetic collision', 'SyntheticPassword123!');
        await db.collection('users').deleteOne({ _id: new ObjectId(bobId) });
        assert.equal((await rpc(app, bobToken, 'tools/list')).status, 401);
        await bob.get('/api/mcp/connections').expect(401);
    });
});
