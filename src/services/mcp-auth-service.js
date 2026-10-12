'use strict';

var crypto = require('crypto'),
    users = require('../users.js'),
    createRepository = require('../database/mcp.js'),
    errors = require('@modelcontextprotocol/sdk/server/auth/errors.js');

var ACCESS_SECONDS = 24 * 60 * 60;

function random() { return crypto.randomBytes(32).toString('base64url'); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function expiry(seconds) { return new Date(Date.now() + seconds * 1000); }

async function getActiveUser(userId) {
    var user = await users.getRepository().get(userId);
    if (!user || user.status === 'disabled' || user.id !== userId) throw new Error('User unavailable');
    return { id: user.id || user.username, username: user.username };
}

function createProvider(settings) {
    var repository = createRepository();
    var resource = settings.publicUrl + '/mcp';

    function requireResource(value) {
        if (!value || value.href !== resource) throw new errors.InvalidTargetError('Invalid resource');
    }

    async function activeGrant(id) {
        var grant = await repository.get('grants', id);
        if (!grant || grant.revoked) throw new errors.InvalidTokenError('Authorization expired or revoked');
        try { await getActiveUser(grant.userId); } catch (error) { throw new errors.InvalidTokenError('User unavailable'); }
        return grant;
    }

    var provider = {
        clientsStore: {
            getClient: async function (id) {
                var client = await repository.get('clients', id);
                return client ? client.info : undefined;
            },
            registerClient: async function (metadata) {
                if (!metadata.redirect_uris || metadata.redirect_uris.length > 10 ||
                    metadata.redirect_uris.some(function (uri) { return !settings.redirectUris.includes(uri); })) {
                    throw new errors.InvalidClientMetadataError('Redirect URI is not allowed');
                }
                if (metadata.grant_types && (metadata.grant_types.length !== 1 || metadata.grant_types[0] !== 'authorization_code')) {
                    throw new errors.InvalidClientMetadataError('Only authorization_code is supported');
                }
                if (metadata.response_types && (metadata.response_types.length !== 1 || metadata.response_types[0] !== 'code')) {
                    throw new errors.InvalidClientMetadataError('Only code responses are supported');
                }
                if (metadata.scope && metadata.scope !== 'notes.read') throw new errors.InvalidScopeError('Only notes.read is supported');
                var method = metadata.token_endpoint_auth_method || 'client_secret_post';
                if (!['none', 'client_secret_post'].includes(method)) throw new errors.InvalidClientMetadataError('Unsupported client authentication');
                if (await repository.count('clients', {}) >= 500) throw new errors.TooManyRequestsError('Client capacity reached');
                var info = {
                    client_id: random(), client_id_issued_at: Math.floor(Date.now() / 1000),
                    redirect_uris: metadata.redirect_uris, client_name: (metadata.client_name || 'Gemini').slice(0, 100),
                    token_endpoint_auth_method: method, grant_types: ['authorization_code'], response_types: ['code'], scope: 'notes.read'
                };
                if (method !== 'none') {
                    info.client_secret = random();
                    info.client_secret_expires_at = Math.floor(Date.now() / 1000) + 30 * ACCESS_SECONDS;
                }
                var stored = Object.assign({}, info);
                if (stored.client_secret) stored.client_secret = hash(stored.client_secret);
                await repository.insert('clients', { _id: info.client_id, info: stored, expiresAt: expiry(30 * ACCESS_SECONDS) });
                return info;
            }
        },
        authorize: async function (client, params, res) {
            requireResource(params.resource);
            if (params.scopes && params.scopes.length && (params.scopes.length !== 1 || params.scopes[0] !== 'notes.read')) {
                throw new errors.InvalidScopeError('Only notes.read is supported');
            }
            if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge)) throw new errors.InvalidRequestError('Invalid S256 challenge');
            if (params.state && params.state.length > 1000) throw new errors.InvalidRequestError('State too long');
            if (!settings.redirectUris.includes(params.redirectUri)) throw new errors.InvalidRequestError('Redirect URI is not allowed');
            if (await repository.count('requests', { clientId: client.client_id }) >= 20) throw new errors.TooManyRequestsError('Too many pending authorizations');
            var request = random();
            await repository.insert('requests', {
                _id: hash(request), clientId: client.client_id, redirectUri: params.redirectUri,
                state: params.state, challenge: params.codeChallenge, expiresAt: expiry(600)
            });
            res.redirect(settings.publicUrl + '/assistant/authorize?request=' + request);
        },
        challengeForAuthorizationCode: async function (client, code) {
            var record = await repository.get('codes', hash(code));
            if (!record || record.clientId !== client.client_id) throw new errors.InvalidGrantError('Invalid authorization code');
            return record.challenge;
        },
        exchangeAuthorizationCode: async function (client, code, verifier, redirectUri, requestedResource) {
            requireResource(requestedResource);
            var record = await repository.consume('codes', { _id: hash(code), clientId: client.client_id, redirectUri: redirectUri });
            if (!record) throw new errors.InvalidGrantError('Invalid authorization code');
            var grant = await activeGrant(record.grantId);
            var token = random();
            await repository.insert('tokens', {
                _id: hash(token), clientId: client.client_id, grantId: grant._id, expiresAt: grant.expiresAt
            });
            return { access_token: token, token_type: 'Bearer', expires_in: Math.max(0, Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000)), scope: 'notes.read' };
        },
        exchangeRefreshToken: async function () { throw new errors.UnsupportedGrantTypeError('Refresh tokens are not supported'); },
        verifyAccessToken: async function (token) {
            if (typeof token !== 'string' || token.length > 256) throw new errors.InvalidTokenError('Invalid token');
            var record = await repository.get('tokens', hash(token));
            if (!record || !await provider.clientsStore.getClient(record.clientId)) throw new errors.InvalidTokenError('Invalid token');
            var grant = await activeGrant(record.grantId);
            return {
                token: token, clientId: record.clientId, scopes: ['notes.read'], resource: resource,
                expiresAt: Math.floor(record.expiresAt.getTime() / 1000), extra: { userId: grant.userId, grantId: grant._id }
            };
        },
        revokeToken: async function (client, request) {
            await repository.revokeToken(client.client_id, hash(request.token));
        },
        consentInfo: async function (request, userId) {
            var record = await repository.claimRequest(hash(request), userId);
            if (!record) throw new errors.InvalidRequestError('Authorization request expired or unavailable');
            var client = await provider.clientsStore.getClient(record.clientId);
            if (!client) throw new errors.InvalidClientError('Client expired');
            return { clientName: client.client_name, scope: 'notes.read', expiresIn: ACCESS_SECONDS };
        },
        decide: async function (request, userId, allow) {
            var record = await repository.consume('requests', { _id: hash(request), userId: userId });
            if (!record) throw new errors.InvalidRequestError('Authorization request expired or unavailable');
            var url = new URL(record.redirectUri);
            if (record.state) url.searchParams.set('state', record.state);
            if (!allow) {
                url.searchParams.set('error', 'access_denied');
                return url.href;
            }
            var client = await provider.clientsStore.getClient(record.clientId);
            if (!client || !settings.redirectUris.includes(record.redirectUri)) throw new errors.InvalidClientError('Client unavailable');
            if (await repository.count('grants', { userId: userId, revoked: { $ne: true } }) >= 50) throw new errors.TooManyRequestsError('Connection capacity reached');
            var grant = await repository.insert('grants', {
                _id: random(), userId: userId, clientId: record.clientId, clientName: client.client_name,
                createdAt: new Date(), expiresAt: expiry(ACCESS_SECONDS)
            });
            var code = random();
            await repository.insert('codes', {
                _id: hash(code), clientId: record.clientId, grantId: grant._id,
                redirectUri: record.redirectUri, challenge: record.challenge, expiresAt: expiry(180)
            });
            url.searchParams.set('code', code);
            return url.href;
        },
        listConnections: async function (userId) {
            var grants = await repository.listGrants(userId);
            return grants.map(function (grant) {
                return { id: grant._id, clientName: grant.clientName, scope: 'notes.read', createdAt: grant.createdAt, expiresAt: grant.expiresAt };
            });
        },
        revokeConnection: function (userId, id) { return repository.revokeGrant(userId, id); }
    };
    return provider;
}

module.exports = { createProvider: createProvider, getActiveUser: getActiveUser, hash: hash, random: random };
