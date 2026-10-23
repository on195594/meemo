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
        dbClient = await MongoClient.connect(config.databaseUrl, { monitorCommands: true });
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
        var initialTtlDays = (stored.expiresAt.getTime() - Date.now()) / (24 * 3600 * 1000);
        assert(initialTtlDays > 25 && initialTtlDays <= 31, 'Unused client registration must be bounded to ~30 days');

        var token = await connect(app, alice, confidential);
        assert(await db.collection('mcp_tokens').findOne({ _id: hash(token) }));
        assert.equal(await db.collection('mcp_tokens').findOne({ _id: token }), null);

        var extended = await db.collection('mcp_clients').findOne({ _id: confidential.client_id });
        var extendedYears = (extended.expiresAt.getTime() - Date.now()) / (365 * 24 * 3600 * 1000);
        assert(extendedYears > 90, 'Authorized client must have expiration extended to match grant lifetime');
    });

    it('extends pre-existing client TTL upon re-authorization so long-lived tokens do not expire with old client TTL', async function () {
        var oldClient = await register(app, 'none');
        var nearExpiry = new Date(Date.now() + 5000);
        await db.collection('mcp_clients').updateOne({ _id: oldClient.client_id }, { $set: { expiresAt: nearExpiry } });

        var token = await connect(app, alice, oldClient);
        var clientAfter = await db.collection('mcp_clients').findOne({ _id: oldClient.client_id });
        var extendedYears = (clientAfter.expiresAt.getTime() - Date.now()) / (365 * 24 * 3600 * 1000);
        assert(extendedYears > 90, 'Client expiration must be extended beyond pre-upgrade nearExpiry');

        var notesRes = toolBody(await rpc(app, token, 'tools/call', { name: 'get_note', arguments: { id: noteId } }));
        assert.equal(notesRes.content, 'private marker #alpha #beta');
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
        assert.deepEqual(readTools, ['batch_get_notes', 'get_note', 'list_tags', 'search_notes']);
        assert.deepEqual(writeTools, ['batch_delete_notes', 'create_note', 'delete_note', 'update_note']);
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

    it('returns complete Markdown with search summaries in one query when requested', async function () {
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-search-content', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var content = '# bulkmarkdown\n\n' + '正文😀 **bold**\n'.repeat(50);
        var first = await things.insertFull(aliceId, content, [], [], [], 10, 10);
        var second = await things.insertFull(aliceId, content + 'second', [], [], [], 11, 11);
        var finds = [];
        function record(event) { if (event.commandName === 'find' && event.command.find === 'things') finds.push(event.command); }
        dbClient.on('commandStarted', record);
        try {
            for (var mode of ['regex', 'text']) {
                finds.length = 0;
                var full = toolBody(await rpc(isolated, aliceToken, 'tools/call', {
                    name: 'search_notes', arguments: { query: 'bulkmarkdown', mode: mode, include_content: true, limit: 1 }
                }));
                assert.equal(finds.length, 1, 'Search must not fetch each note separately');
                assert.equal(finds[0].projection.content, 1);
                assert([first._id, second._id].includes(full.notes[0].id));
                assert.equal(full.notes[0].content, full.notes[0].id === first._id ? content : content + 'second');
                assert.equal(full.notes[0].summary, Array.from(content).slice(0, 300).join(''));
                assert.equal(full.hasMore, true);
            }
            var defaults = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'bulkmarkdown' } }));
            var disabled = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'bulkmarkdown', include_content: false } }));
            assert.deepEqual(defaults, disabled);
            assert(defaults.notes.every(function (note) { return note.content === undefined; }));
            var page = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'bulkmarkdown', include_content: true, skip: 1, limit: 1 } }));
            assert.equal(page.notes[0].content, content);
            assert.equal(page.hasMore, false);
            var scoped = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'search_notes', arguments: { query: 'marker', include_content: true } }));
            assert.deepEqual(scoped.notes.map(function (note) { return note.id; }), [noteId]);
            assert.equal(scoped.notes[0].content, 'private marker #alpha #beta');
            var oversized = await things.insertFull(aliceId, 'oversizebody '.repeat(12000), [], [], [], 12, 12);
            for (var name of ['search_notes', 'batch_get_notes']) {
                var args = name === 'search_notes' ? { query: 'oversizebody', include_content: true } : { ids: [oversized._id] };
                var response = await rpc(isolated, aliceToken, 'tools/call', { name: name, arguments: args });
                assert.equal(response.body.result.isError, true);
                assert.equal(toolBody(response).code, 'result_too_large');
            }
            await things.del(aliceId, oversized._id, oversized.revision);
        } finally {
            dbClient.removeListener('commandStarted', record);
            await things.del(aliceId, first._id, first.revision);
            await things.del(aliceId, second._id, second.revision);
        }
    });

    it('batch reads owner-scoped snapshots including archived notes in one IN query', async function () {
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-batch-read', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var deleted = await things.insertFull(aliceId, 'batch read deleted', [], [], [], 12, 12);
        await things.del(aliceId, deleted._id, deleted.revision);
        var ids = [noteId.toUpperCase(), archivedId, otherId, new ObjectId().toHexString(), deleted._id];
        var finds = [];
        function record(event) { if (event.commandName === 'find' && event.command.find === 'things') finds.push(event.command); }
        dbClient.on('commandStarted', record);
        try {
            var result = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'batch_get_notes', arguments: { ids: ids } }));
            assert.equal(finds.length, 1);
            assert.equal(finds[0].filter._id.$in.length, ids.length);
            assert.deepEqual(result.sort(function (a, b) { return a.id.localeCompare(b.id); }), [
                { id: noteId, content: 'private marker #alpha #beta', revision: 1 },
                { id: archivedId, content: 'archived marker #gamma', revision: 2 }
            ].sort(function (a, b) { return a.id.localeCompare(b.id); }));
        } finally {
            dbClient.removeListener('commandStarted', record);
        }
        assert.deepEqual(toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'batch_get_notes', arguments: { ids: [otherId] } })), []);
        var maximum = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'batch_get_notes', arguments: { ids: Array(20).fill(noteId) } }));
        assert.equal(maximum.length, 1);
    });

    it('batch deletes in one tool call and reports per-note failures without rolling back successes', async function () {
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-batch-delete',
            logger: logger.createLogger({ enabled: true, stream: function (entry) { logs.push(JSON.stringify(entry)); } }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var first = await things.insertFull(aliceId, 'batch delete first', [], [], [], 13, 13);
        var second = await things.insertFull(aliceId, 'batch delete second', [], [], [], 14, 14);
        var stale = await things.insertFull(aliceId, 'batch delete stale', [], [], [], 15, 15);
        var publicNote = await things.insertFull(aliceId, 'batch delete public', [], [], [], 16, 16);
        var sharedNote = await things.insertFull(aliceId, 'batch delete shared', [], [], [], 17, 17);
        await db.collection('things').updateOne({ _id: new ObjectId(publicNote._id) }, { $set: { public: true } });
        await db.collection('things').updateOne({ _id: new ObjectId(sharedNote._id) }, { $set: { shared: true } });
        var missingId = new ObjectId().toHexString();
        var items = [
            { id: first._id, expectedRevision: 1 },
            { id: stale._id, expectedRevision: 999 },
            { id: otherId, expectedRevision: 1 },
            { id: publicNote._id, expectedRevision: 1 },
            { id: sharedNote._id, expectedRevision: 1 },
            { id: missingId, expectedRevision: 1 },
            { id: second._id, expectedRevision: 1 },
            { id: first._id, expectedRevision: 1 }
        ];
        var beforeCount = logs.filter(function (line) { return line.includes('"event":"mcp_tool"'); }).length;
        var result = toolBody(await rpc(isolated, aliceToken, 'tools/call', { name: 'batch_delete_notes', arguments: { items: items } }));
        assert.deepEqual(result, { deleted: [first._id, second._id], errors: [
            { id: stale._id, code: 'revision_conflict' }, { id: otherId, code: 'not_found' },
            { id: publicNote._id, code: 'not_allowed' }, { id: sharedNote._id, code: 'not_allowed' },
            { id: missingId, code: 'not_found' }, { id: first._id, code: 'not_found' }
        ] });
        assert.equal(logs.filter(function (line) { return line.includes('"event":"mcp_tool"'); }).length, beforeCount + 1);
        var snapshots = await db.collection('things').find({ _id: { $in: [new ObjectId(first._id), new ObjectId(second._id)] } }).toArray();
        assert.equal(snapshots.length, 2, 'Deletion must retain the notes in trash');
        assert(snapshots.every(function (note) { return note.deletedAt && note.revision === 2; }));
        for (var item of [stale, publicNote, sharedNote]) assert.equal((await things.get(aliceId, item._id)).deletedAt, undefined);
        assert.equal((await things.get(bobId, otherId)).deletedAt, undefined);
        var success = toolBody(await rpc(isolated, aliceToken, 'tools/call', {
            name: 'batch_delete_notes', arguments: { items: [{ id: stale._id, expectedRevision: 1 }] }
        }));
        assert.deepEqual(success, { deleted: [stale._id], errors: [] });
    });

    it('validates batch inputs before writes and enforces read-only and revoked grants', async function () {
        var isolated = createApp({ sessionMemory: true, sessionSecret: 'synthetic-batch-validation', logger: logger.createLogger({ enabled: false }),
            mcp: { enabled: true, publicUrl: origin, redirectUris: [callback] } });
        var note = await things.insertFull(aliceId, 'batch validation note', [], [], [], 18, 18);
        var item = { id: note._id, expectedRevision: 1 };
        var cases = [
            ['search_notes', { include_content: 'true' }],
            ['batch_get_notes', { ids: [] }], ['batch_get_notes', { ids: Array(21).fill(note._id) }],
            ['batch_get_notes', { ids: ['invalid'] }], ['batch_get_notes', { ids: [note._id], userId: bobId }],
            ['batch_delete_notes', { items: [] }], ['batch_delete_notes', { items: Array(21).fill(item) }],
            ['batch_delete_notes', { items: [item, { id: note._id }] }],
            ['batch_delete_notes', { items: [item, { id: 'invalid', expectedRevision: 1 }] }],
            ['batch_delete_notes', { items: [item, { id: note._id, expectedRevision: 0 }] }],
            ['batch_delete_notes', { items: [item, { id: note._id, expectedRevision: 1.5 }] }],
            ['batch_delete_notes', { items: [Object.assign({}, item, { content: 'extra' })] }]
        ];
        for (var test of cases) {
            var rejected = await rpc(isolated, aliceToken, 'tools/call', { name: test[0], arguments: test[1] });
            assert(rejected.body.result.isError || rejected.body.error, JSON.stringify(test));
        }
        assert.equal((await things.get(aliceId, note._id)).revision, 1);
        var verifier = crypto.randomBytes(32).toString('base64url');
        var readConsent = await consent(isolated, alice, client, verifier, true, 'notes.read');
        var token = (await exchange(isolated, client, verifier, readConsent.redirect.searchParams.get('code'))).body.access_token;
        var read = toolBody(await rpc(isolated, token, 'tools/call', { name: 'batch_get_notes', arguments: { ids: [note._id] } }));
        assert.equal(read[0].id, note._id);
        var denied = toolBody(await rpc(isolated, token, 'tools/call', { name: 'batch_delete_notes', arguments: { items: [item] } }));
        assert.equal(denied.code, 'insufficient_scope');
        await protocol(isolated, 'post', '/oauth/revoke').type('form').send({ client_id: client.client_id, token: token }).expect(200);
        for (var name of ['batch_get_notes', 'batch_delete_notes']) {
            var args = name === 'batch_get_notes' ? { ids: [note._id] } : { items: [item] };
            assert.equal((await rpc(isolated, token, 'tools/call', { name: name, arguments: args })).status, 401);
        }
        assert.equal((await things.get(aliceId, note._id)).revision, 1);
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

    it('marks assistant writes with changed fields until the owner writes or restores', async function () {
        var created = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'assistant draft #provenance' }
        }));
        var stored = await db.collection('things').findOne({ _id: new ObjectId(created.id) });
        assert.equal(stored.assistant.action, 'create');
        assert.equal(stored.assistant.client, 'Synthetic Gemini');
        assert.equal(stored.assistant.previous, undefined);

        toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: created.id, expectedRevision: 1, content: 'assistant rewrite #provenance', sticky: true }
        }));
        stored = await db.collection('things').findOne({ _id: new ObjectId(created.id) });
        assert.equal(stored.assistant.action, 'update');
        assert.deepEqual(stored.assistant.previous, { content: 'assistant draft #provenance', sticky: false });
        var listed = (await alice.get('/api/things').query({ filter: 'rewrite' }).expect(200)).body.things;
        assert.deepEqual(listed[0].assistant.previous, stored.assistant.previous, 'owner REST reads expose the marker for undo');

        // Owner undo is an ordinary revision-checked PUT and clears the marker.
        var undone = (await alice.put('/api/things/' + created.id).send({
            content: stored.assistant.previous.content, sticky: false, expectedRevision: 2
        }).expect(201)).body.thing;
        assert.equal(undone.content, 'assistant draft #provenance');
        assert.equal(undone.assistant, undefined);

        toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'delete_note', arguments: { id: created.id, expectedRevision: 3 }
        }));
        stored = await db.collection('things').findOne({ _id: new ObjectId(created.id) });
        assert.equal(stored.assistant.action, 'delete');
        var restored = (await alice.post('/api/things/' + created.id + '/restore').send({ expectedRevision: 4 }).expect(200)).body.thing;
        assert.equal(restored.assistant, undefined);
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

    it('rejects concurrent write races with the same expectedRevision to prevent overwrite conflicts', async function () {
        var created = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'concurrency test note #race' }
        }));
        assert.equal(created.revision, 1);

        var results = await Promise.all([
            rpc(app, aliceToken, 'tools/call', {
                name: 'update_note', arguments: { id: created.id, expectedRevision: 1, content: 'race update A' }
            }),
            rpc(app, aliceToken, 'tools/call', {
                name: 'update_note', arguments: { id: created.id, expectedRevision: 1, content: 'race update B' }
            })
        ]);

        var bodies = results.map(function (res) { return toolBody(res); });
        var succeeded = bodies.filter(function (b) { return b.revision === 2; });
        var conflicts = bodies.filter(function (b) { return b.code === 'revision_conflict'; });

        assert.equal(succeeded.length, 1, 'Exactly one concurrent update must succeed');
        assert.equal(conflicts.length, 1, 'The competing concurrent update must receive a revision_conflict');

        var current = toolBody(await rpc(app, aliceToken, 'tools/call', { name: 'get_note', arguments: { id: created.id } }));
        assert.equal(current.revision, 2);
        assert(['race update A', 'race update B'].includes(current.content));
    });

    it('preserves attachments, color, sticky, and archived properties when updating only partial fields', async function () {
        var noteWithAttachmentsId = new ObjectId();
        var sampleAttachments = [
            { id: 'att-1', name: 'diagram.png', size: 1024, mime: 'image/png' },
            { id: 'att-2', name: 'data.csv', size: 2048, mime: 'text/csv' }
        ];
        await db.collection('things').insertOne({
            _id: noteWithAttachmentsId, ownerId: aliceId, content: 'initial note #tagged',
            tags: [{ name: 'tagged' }], attachments: sampleAttachments,
            color: 'sage', sticky: true, archived: false,
            createdAt: 1000, modifiedAt: 1000, revision: 1, public: false, shared: false
        });

        // 1. Update ONLY content
        var update1 = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: noteWithAttachmentsId.toHexString(), expectedRevision: 1, content: 'updated content #preserved' }
        }));
        assert.equal(update1.revision, 2);

        var noteAfter1 = await db.collection('things').findOne({ _id: noteWithAttachmentsId });
        assert.equal(noteAfter1.content, 'updated content #preserved');
        assert.deepEqual(noteAfter1.attachments, sampleAttachments, 'Attachments must be preserved across content-only update');
        assert.equal(noteAfter1.color, 'sage', 'Color must be preserved');
        assert.equal(noteAfter1.sticky, true, 'Sticky pin must be preserved');
        assert.equal(noteAfter1.archived, false, 'Archived status must be preserved');

        // 2. Update ONLY color
        var update2 = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: noteWithAttachmentsId.toHexString(), expectedRevision: 2, color: 'coral' }
        }));
        assert.equal(update2.revision, 3);

        var noteAfter2 = await db.collection('things').findOne({ _id: noteWithAttachmentsId });
        assert.equal(noteAfter2.content, 'updated content #preserved', 'Content must be preserved across color-only update');
        assert.deepEqual(noteAfter2.attachments, sampleAttachments, 'Attachments must be preserved across color-only update');
        assert.equal(noteAfter2.color, 'coral');
        assert.equal(noteAfter2.sticky, true);

        // 3. Update ONLY sticky pin
        var update3 = toolBody(await rpc(app, aliceToken, 'tools/call', {
            name: 'update_note', arguments: { id: noteWithAttachmentsId.toHexString(), expectedRevision: 3, sticky: false }
        }));
        assert.equal(update3.revision, 4);

        var noteAfter3 = await db.collection('things').findOne({ _id: noteWithAttachmentsId });
        assert.equal(noteAfter3.sticky, false);
        assert.equal(noteAfter3.color, 'coral', 'Color must remain preserved');
        assert.deepEqual(noteAfter3.attachments, sampleAttachments, 'Attachments must remain preserved');
    });

    it('rejects create, update, and delete calls after grant revocation', async function () {
        var verifier = crypto.randomBytes(32).toString('base64url');
        var writeConsent = await consent(app, alice, client, verifier, true, 'notes.read notes.write');
        var tokenRes = await exchange(app, client, verifier, writeConsent.redirect.searchParams.get('code'));
        var revokeToken = tokenRes.body.access_token;

        var created = toolBody(await rpc(app, revokeToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'pre-revocation note' }
        }));
        assert(created.id);
        assert.equal(created.revision, 1);

        var tokenRecord = await db.collection('mcp_tokens').findOne({ _id: hash(revokeToken) });
        assert(tokenRecord);
        var conns = (await alice.get('/api/mcp/connections').expect(200)).body;
        await alice.delete('/api/mcp/connections/' + tokenRecord.grantId).set('X-CSRF-Token', conns.csrfToken).expect(204);

        var postRevokeCreate = await rpc(app, revokeToken, 'tools/call', {
            name: 'create_note', arguments: { content: 'post-revocation write attempt' }
        });
        assert.equal(postRevokeCreate.status, 401);
        assert.equal(postRevokeCreate.body.error, 'invalid_token');

        var postRevokeUpdate = await rpc(app, revokeToken, 'tools/call', {
            name: 'update_note', arguments: { id: created.id, expectedRevision: 1, content: 'post-revocation update' }
        });
        assert.equal(postRevokeUpdate.status, 401);
        assert.equal(postRevokeUpdate.body.error, 'invalid_token');

        var postRevokeDelete = await rpc(app, revokeToken, 'tools/call', {
            name: 'delete_note', arguments: { id: created.id, expectedRevision: 1 }
        });
        assert.equal(postRevokeDelete.status, 401);
        assert.equal(postRevokeDelete.body.error, 'invalid_token');
    });

    it('enforces strict two-way isolation between browser sessions and MCP tokens', async function () {
        // 1. Browser session cookie cannot authenticate /mcp protocol endpoint without Bearer token
        var sessionToMcp = await alice.post('/mcp').set('Host', 'meemo.example').set('Accept', 'application/json, text/event-stream')
            .send({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
        assert.equal(sessionToMcp.status, 401);
        assert.equal(sessionToMcp.body.error, 'invalid_token');

        // 2. MCP Bearer token cannot access browser REST endpoints
        await protocol(app, 'get', '/api/things').set('Authorization', 'Bearer ' + aliceToken).expect(401);
        await protocol(app, 'post', '/api/things').set('Authorization', 'Bearer ' + aliceToken)
            .send({ content: 'bypass attempt' }).expect(401);
        await protocol(app, 'put', '/api/things/' + noteId).set('Authorization', 'Bearer ' + aliceToken)
            .send({ content: 'bypass attempt' }).expect(401);
        await protocol(app, 'delete', '/api/things/' + noteId).set('Authorization', 'Bearer ' + aliceToken).expect(401);
        await protocol(app, 'get', '/api/profile').set('Authorization', 'Bearer ' + aliceToken).expect(401);

        // 3. MCP Bearer token cannot access browser MCP management endpoints (/api/mcp/connections, /api/mcp/consent)
        await protocol(app, 'get', '/api/mcp/connections').set('Authorization', 'Bearer ' + aliceToken).expect(401);
        await protocol(app, 'get', '/api/mcp/consent').set('Authorization', 'Bearer ' + aliceToken).query({ request: 'any' }).expect(401);
        await protocol(app, 'post', '/api/mcp/consent').set('Authorization', 'Bearer ' + aliceToken).send({ request: 'any', allow: true }).expect(401);
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
