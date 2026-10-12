'use strict';

var express = require('express'),
    crypto = require('crypto'),
    cors = require('cors'),
    z = require('zod'),
    rateLimit = require('express-rate-limit').rateLimit,
    StreamableHTTPServerTransport = require('@modelcontextprotocol/sdk/server/streamableHttp.js').StreamableHTTPServerTransport,
    authorizationHandler = require('@modelcontextprotocol/sdk/server/auth/handlers/authorize.js').authorizationHandler,
    tokenHandler = require('@modelcontextprotocol/sdk/server/auth/handlers/token.js').tokenHandler,
    clientRegistrationHandler = require('@modelcontextprotocol/sdk/server/auth/handlers/register.js').clientRegistrationHandler,
    revocationHandler = require('@modelcontextprotocol/sdk/server/auth/handlers/revoke.js').revocationHandler,
    requireBearerAuth = require('@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js').requireBearerAuth,
    auth = require('./middleware/auth.js'),
    authService = require('../services/mcp-auth-service.js'),
    createCaptureStore = require('../storage/mcp-bootstrap.js'),
    createServer = require('./mcp-tools.js');

function settingsFromOptions(options) {
    var supplied = options.mcp || {};
    var enabled = supplied.enabled !== undefined ? supplied.enabled : process.env.MCP_ENABLED === 'true';
    var bootstrap = supplied.bootstrapUntil !== undefined ? supplied.bootstrapUntil : process.env.MCP_BOOTSTRAP_UNTIL;
    var until = bootstrap ? Date.parse(bootstrap) : undefined;
    if (bootstrap && (enabled || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(bootstrap) ||
        !Number.isFinite(until) || until > Date.now() + 30 * 60000)) throw new Error('MCP bootstrap requires MCP_ENABLED=false and a UTC deadline within 30 minutes');
    if (!enabled && (!until || until <= Date.now())) return { enabled: false };
    var url = new URL(supplied.publicUrl || process.env.MCP_PUBLIC_URL || '');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname) && !options.isProduction && process.env.NODE_ENV !== 'production')) {
        throw new Error('MCP_PUBLIC_URL must be HTTPS (HTTP loopback only in development)');
    }
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('MCP_PUBLIC_URL must be a bare origin');
    var redirectUris = supplied.redirectUris || (process.env.MCP_REDIRECT_URIS || '').split(',').filter(Boolean);
    if ((!until && !redirectUris.length) || redirectUris.length > 10) throw new Error('MCP_REDIRECT_URIS must specify exact approved HTTPS callbacks');
    redirectUris.forEach(function (uri) {
        var callback = new URL(uri);
        if (callback.protocol !== 'https:' || callback.username || callback.password || callback.hash || uri.includes('*')) throw new Error('Invalid MCP redirect URI');
    });
    var origins = supplied.allowedOrigins || (process.env.MCP_ALLOWED_ORIGINS || '').split(',').filter(Boolean);
    origins.forEach(function (origin) {
        if (new URL(origin).origin !== origin || !origin.startsWith('https://')) throw new Error('Invalid MCP allowed origin');
    });
    return { enabled: true, bootstrapUntil: until, publicUrl: url.origin, host: url.host, redirectUris: redirectUris, allowedOrigins: [url.origin].concat(origins) };
}

// shortcut: rate limits are per process; coordinate them before running multiple replicas.
function limit(max, keyGenerator) {
    return rateLimit({ windowMs: 60000, limit: max, standardHeaders: 'draft-7', legacyHeaders: false,
        ...(keyGenerator ? { keyGenerator: keyGenerator } : {}),
        message: { error: 'rate_limited', message: 'Too many requests; retry later.' } });
}

function wrap(handler) {
    return function (req, res, next) { Promise.resolve(handler(req, res)).catch(next); };
}

function protocolError(error, req, res, next) {
    if (res.destroyed) return;
    if (res.headersSent) return next(error);
    res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: 'invalid_request' });
}

function createMcp(options, logger) {
    var settings = settingsFromOptions(options);
    var protocol = express.Router();
    var browser = express.Router();
    var protocolPaths = ['/mcp', '/oauth', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource'];
    if (!settings.enabled) {
        protocol.use(protocolPaths.concat(['/api/mcp']), function (req, res) { res.status(404).json({ error: 'mcp_disabled' }); });
        return { protocol: protocol, browser: browser };
    }
    var metadataUrl = settings.publicUrl + '/.well-known/oauth-protected-resource/mcp';

    protocol.use(protocolPaths, function (req, res, next) {
        if (settings.bootstrapUntil && Date.now() >= settings.bootstrapUntil) return res.status(404).json({ error: 'mcp_bootstrap_expired' });
        if (req.get('host') !== settings.host || (req.get('origin') && !settings.allowedOrigins.includes(req.get('origin')))) {
            return res.status(403).json({ error: 'invalid_origin_or_host' });
        }
        res.set('Cache-Control', 'no-store');
        res.set('Referrer-Policy', 'no-referrer');
        var deadline = setTimeout(function () { res.destroy(); }, 15000);
        deadline.unref();
        res.once('close', function () { clearTimeout(deadline); });
        next();
    }, cors({ origin: settings.allowedOrigins, methods: ['GET', 'POST', 'OPTIONS'],
        allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version'], exposedHeaders: ['WWW-Authenticate'], preflightContinue: true }), limit(120), function (req, res, next) {
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        next();
    });
    protocol.use('/oauth', express.urlencoded({ extended: false, limit: '16kb' }), express.json({ limit: '16kb' }));
    protocol.get('/.well-known/oauth-protected-resource/mcp', function (req, res) {
        res.json({ resource: settings.publicUrl + '/mcp', authorization_servers: [settings.publicUrl], scopes_supported: ['notes.read'], resource_name: 'Meemo private notes' });
    });
    protocol.get('/.well-known/oauth-authorization-server', function (req, res) {
        res.json({ issuer: settings.publicUrl, authorization_endpoint: settings.publicUrl + '/oauth/authorize',
            token_endpoint: settings.publicUrl + '/oauth/token', registration_endpoint: settings.publicUrl + '/oauth/register',
            revocation_endpoint: settings.publicUrl + '/oauth/revoke', response_types_supported: ['code'],
            grant_types_supported: ['authorization_code'], code_challenge_methods_supported: ['S256'],
            token_endpoint_auth_methods_supported: ['none', 'client_secret_post'], scopes_supported: ['notes.read'] });
    });
    if (settings.bootstrapUntil) {
        var capture = createCaptureStore(settings.bootstrapUntil);
        protocol.post('/oauth/register', wrap(async function (req, res) {
            var uris = req.body && req.body.redirect_uris;
            var hosts = ['oauth-redirect.googleusercontent.com', 'oauth-redirect-test.googleusercontent.com', 'oauth-redirect-sandbox.googleusercontent.com'];
            if (Array.isArray(uris) && uris.length > 0 && uris.length <= 10 && uris.every(function (uri) {
                if (typeof uri !== 'string' || uri.length > 512) return false;
                try {
                    var url = new URL(uri);
                    return url.href === uri && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
                        hosts.includes(url.hostname) && /^\/[ra]\/user_bound_custom-mcp-[A-Za-z0-9_-]+$/.test(url.pathname);
                } catch (_) { return false; }
            })) await capture(uris);
            res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Setup only: registration is denied pending operator review. No credentials issued.' });
        }));
        protocol.all('/mcp', function (req, res) {
            res.set('WWW-Authenticate', 'Bearer resource_metadata="' + metadataUrl + '", scope="notes.read"')
                .status(401).json({ error: 'bootstrap_only' });
        });
        protocol.use('/oauth', function (req, res) { res.status(403).json({ error: 'bootstrap_only' }); });
        protocol.use('/api/mcp', function (req, res) { res.status(404).json({ error: 'bootstrap_only' }); });
        protocol.use(protocolPaths, function (req, res) { res.status(404).json({ error: 'not_found' }); });
        protocol.use(protocolError);
        return { protocol: protocol, browser: browser };
    }
    var provider = authService.createProvider(settings);
    protocol.use('/oauth/register', function (req, res, next) {
        var keys = ['redirect_uris', 'client_name', 'token_endpoint_auth_method', 'grant_types', 'response_types', 'scope'];
        if (req.method === 'POST' && (!req.body || Object.keys(req.body).some(function (key) { return !keys.includes(key); }) ||
            (req.body.client_name && (typeof req.body.client_name !== 'string' || req.body.client_name.length > 100)))) {
            return res.status(400).json({ error: 'invalid_client_metadata' });
        }
        next();
    }, clientRegistrationHandler({ clientsStore: provider.clientsStore, rateLimit: false }));
    protocol.use('/oauth/authorize', authorizationHandler({ provider: provider, rateLimit: false }));
    // The SDK compares client_secret values; normalize the incoming secret to its stored hash.
    protocol.use(['/oauth/token', '/oauth/revoke'], function (req, res, next) {
        if (req.body && typeof req.body.client_secret === 'string') req.body.client_secret = authService.hash(req.body.client_secret);
        next();
    });
    protocol.use('/oauth/token', tokenHandler({ provider: provider, rateLimit: false }));
    protocol.use('/oauth/revoke', revocationHandler({ provider: provider, rateLimit: false }));

    var bearer = requireBearerAuth({ verifier: provider, requiredScopes: ['notes.read'], resourceMetadataUrl: metadataUrl, expectedResource: settings.publicUrl + '/mcp' });
    var inFlight = 0;
    protocol.use('/mcp', bearer, limit(60, function (req) { return req.auth.clientId; }), limit(60, function (req) { return req.auth.extra.userId; }), function (req, res, next) {
        if (res.destroyed) return;
        if (inFlight >= 16) return res.status(429).json({ error: 'concurrency_limit' });
        inFlight++;
        res.once('close', function () { inFlight--; });
        next();
    });
    protocol.post('/mcp', express.json({ limit: '64kb' }), wrap(async function (req, res) {
        if (res.destroyed) return;
        if (Array.isArray(req.body) || (req.body && req.body.id !== undefined && Buffer.byteLength(JSON.stringify(req.body.id)) > 256)) {
            return res.status(400).json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Use a single request with an ID of at most 256 serialized bytes' } });
        }
        var server = createServer(provider, logger, req.id);
        var transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
        res.on('close', function () { server.close().catch(function () {}); });
        await server.connect(transport);
        if (res.destroyed) { await server.close(); return; }
        await transport.handleRequest(req, res, req.body);
    }));
    protocol.all('/mcp', function (req, res) { res.set('Allow', 'POST, OPTIONS').status(405).json({ error: 'stateless_transport' }); });
    protocol.use(protocolPaths, function (req, res) { res.status(404).json({ error: 'not_found' }); });
    protocol.use(protocolError);

    browser.use('/api/mcp', function (req, res, next) {
        res.set('Cache-Control', 'no-store').set('Referrer-Policy', 'no-referrer');
        if (req.get('origin') && req.get('origin') !== settings.publicUrl) return res.status(403).json({ error: 'invalid_origin' });
        next();
    }, auth, limit(60));
    browser.use('/api/mcp', function (req, res, next) {
        if (!req.session.userId) return res.status(401).json({ error: 'login_required', message: 'Log in again with a stable user identity.' });
        authService.getActiveUser(req.session.userId).then(function (user) {
            req.user = user;
            if (!req.session.mcpCsrf) req.session.mcpCsrf = authService.random();
            next();
        }).catch(function () { res.status(401).json({ error: 'user_unavailable' }); });
    });
    browser.use('/api/mcp', limit(60, function (req) { return req.user.id; }), function (req, res, next) {
        if (req.method !== 'GET') {
            var value = req.get('x-csrf-token') || '';
            var expected = req.session.mcpCsrf;
            if (!expected || !/^[A-Za-z0-9_-]{43}$/.test(value) || !crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected))) {
                return res.status(403).json({ error: 'csrf_failed' });
            }
        }
        next();
    });
    browser.get('/api/mcp/connections', wrap(async function (req, res) {
        res.json({ enabled: true, resource: settings.publicUrl + '/mcp', csrfToken: req.session.mcpCsrf, connections: await provider.listConnections(req.user.id) });
    }));
    browser.delete('/api/mcp/connections/:id', wrap(async function (req, res) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(req.params.id)) return res.status(400).json({ error: 'invalid_connection' });
        await provider.revokeConnection(req.user.id, req.params.id);
        res.sendStatus(204);
    }));
    browser.get('/api/mcp/consent', wrap(async function (req, res) {
        var request = z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.query.request);
        res.json(Object.assign({ csrfToken: req.session.mcpCsrf, username: req.user.username }, await provider.consentInfo(request, req.user.id)));
    }));
    browser.post('/api/mcp/consent', wrap(async function (req, res) {
        var body = z.object({ request: z.string().regex(/^[A-Za-z0-9_-]{43}$/), allow: z.boolean() }).strict().parse(req.body);
        res.json({ redirectUrl: await provider.decide(body.request, req.user.id, body.allow) });
    }));
    browser.use('/api/mcp', function (error, req, res, next) {
        if (res.headersSent || (error.status && !error.errorCode)) return next(error);
        res.status(error.errorCode === 'too_many_requests' ? 429 : error instanceof z.ZodError || error.errorCode ? 400 : 500)
            .json({ error: error.errorCode || 'request_failed', message: 'Request unavailable; reconnect or retry.' });
    });
    return { protocol: protocol, browser: browser };
}

module.exports = { createMcp: createMcp };
