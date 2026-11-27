'use strict';

var express = require('express'),
    crypto = require('crypto'),
    z = require('zod/v4'),
    errors = require('../mcp-errors.js');

var safeHttpUrl = z.string().refine(function (value) {
    try {
        var parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
        return false;
    }
}, { message: 'Must be a valid http/https URL' });

var OAuthClientMetadataSchema = z.object({
    redirect_uris: z.array(z.string().refine(function (value) { return URL.canParse(value); })).min(1),
    token_endpoint_auth_method: z.string().optional(),
    grant_types: z.array(z.string()).optional(),
    response_types: z.array(z.string()).optional(),
    client_name: z.string().min(1).max(100).optional(),
    client_uri: safeHttpUrl.optional(),
    logo_uri: safeHttpUrl.optional(),
    scope: z.string().optional(),
    contacts: z.array(z.string()).optional(),
    tos_uri: safeHttpUrl.optional(),
    policy_uri: safeHttpUrl.optional(),
    jwks_uri: safeHttpUrl.optional(),
    jwks: z.object({}).passthrough().optional(),
    software_id: z.string().optional(),
    software_version: z.string().optional()
}).passthrough();

var METADATA_FIELDS = Object.keys(OAuthClientMetadataSchema.shape);

var REGISTRATION_REASONS = new Map([
    ['Redirect URI is not allowed', 'redirect_uri_not_allowed'],
    ['Only authorization_code is supported', 'unsupported_grant_types'],
    ['Only code responses are supported', 'unsupported_response_types'],
    ['Unsupported client authentication', 'unsupported_client_authentication'],
    ['Client capacity reached', 'client_capacity_reached']
]);

function allowedMethods(methods) {
    return function (req, res, next) {
        if (methods.includes(req.method)) return next();
        var error = new errors.MethodNotAllowedError('Method not allowed');
        res.status(405).set('Allow', methods.join(', ')).json(error.toResponseObject());
    };
}

function oauthErrorStatus(error) {
    if (error.code === errors.OAuthErrorCode.ServerError) return 500;
    if (error.code === errors.OAuthErrorCode.TooManyRequests) return 429;
    return 400;
}

function sendOAuthError(res, error) {
    if (error instanceof errors.OAuthError) {
        return res.status(oauthErrorStatus(error)).json(error.toResponseObject());
    }
    return res.status(500).json(new errors.ServerError('Internal Server Error').toResponseObject());
}

function timingSafeTextEqual(a, b) {
    var left = Buffer.from(String(a), 'utf8');
    var right = Buffer.from(String(b), 'utf8');
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createErrorRedirect(redirectUri, error, state) {
    var errorUrl = new URL(redirectUri);
    errorUrl.searchParams.set('error', error.code);
    errorUrl.searchParams.set('error_description', error.message);
    if (error.errorUri) errorUrl.searchParams.set('error_uri', error.errorUri);
    if (state !== undefined) errorUrl.searchParams.set('state', state);
    return errorUrl.href;
}

function logRegistrationRejection(logger, req, status, body, settings) {
    var metadata = req.body || {};
    var uris = Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris : null;
    var method = metadata.token_endpoint_auth_method;
    // Log only known field names and enum values, never descriptions or submitted URLs.
    logger.write({
        level: status >= 500 ? 'error' : 'warn',
        event: 'mcp_registration_rejected',
        requestId: req.id,
        errorCode: body.error,
        reason: REGISTRATION_REASONS.get(body.error_description) ||
            (body.error === 'invalid_client_metadata' ? 'metadata_validation_failed' : body.error),
        metadataFields: METADATA_FIELDS.filter(function (key) { return Object.hasOwn(metadata, key); }),
        authMethod: method === undefined ? 'unspecified'
            : ['none', 'client_secret_post', 'client_secret_basic', 'client_secret_jwt', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth'].includes(method) ? method : 'other',
        grantTypes: Array.isArray(metadata.grant_types) ? metadata.grant_types.slice(0, 10).map(function (grant) {
            return ['authorization_code', 'refresh_token', 'client_credentials', 'password', 'implicit'].includes(grant) ? grant : 'other';
        }) : null,
        redirectUriCount: uris ? uris.length : null,
        unapprovedRedirectUriCount: uris ? uris.filter(function (uri) { return !settings.redirectUris.includes(uri); }).length : null
    });
}

function createRegistrationHandler(options) {
    var clientsStore = options.clientsStore,
        settings = options.settings,
        logger = options.logger;

    var router = express.Router();
    router.use(allowedMethods(['POST']));
    router.post('/', async function (req, res) {
        res.setHeader('Cache-Control', 'no-store');
        try {
            if (!req.body || (req.body.client_name && (typeof req.body.client_name !== 'string' || req.body.client_name.length > 100))) {
                throw new errors.InvalidClientMetadataError('Invalid client metadata');
            }
            var parseResult = OAuthClientMetadataSchema.safeParse(req.body);
            if (!parseResult.success) {
                throw new errors.InvalidClientMetadataError(parseResult.error.message);
            }
            var registered = await clientsStore.registerClient(parseResult.data);
            res.status(201).json(registered);
        } catch (error) {
            var oauthErr = error instanceof errors.OAuthError ? error : new errors.ServerError('Internal Server Error');
            var status = oauthErrorStatus(oauthErr);
            var body = oauthErr.toResponseObject();
            logRegistrationRejection(logger, req, status, body, settings);
            res.status(status).json(body);
        }
    });
    return router;
}

var ClientAuthorizationParamsSchema = z.object({
    client_id: z.string(),
    redirect_uri: z.string().optional().refine(function (value) {
        return value === undefined || URL.canParse(value);
    }, { message: 'redirect_uri must be a valid URL' })
});

var RequestAuthorizationParamsSchema = z.object({
    response_type: z.literal('code'),
    code_challenge: z.string(),
    code_challenge_method: z.literal('S256'),
    scope: z.string().optional(),
    resource: z.string().refine(function (value) { return URL.canParse(value); }).optional()
});

function createAuthorizationHandler(options) {
    var provider = options.provider;
    var router = express.Router();
    router.use(allowedMethods(['GET', 'POST']));
    router.all('/', async function (req, res) {
        res.setHeader('Cache-Control', 'no-store');
        var input = req.method === 'POST' ? req.body : req.query;
        var redirectUri, client;
        try {
            var clientParse = ClientAuthorizationParamsSchema.safeParse(input);
            if (!clientParse.success) throw new errors.InvalidRequestError(clientParse.error.message);
            client = await provider.clientsStore.getClient(clientParse.data.client_id);
            if (!client) throw new errors.InvalidClientError('Invalid client_id');
            if (clientParse.data.redirect_uri !== undefined) {
                var requested = clientParse.data.redirect_uri;
                if (!client.redirect_uris.includes(requested)) {
                    throw new errors.InvalidRequestError('Unregistered redirect_uri');
                }
                redirectUri = requested;
            } else if (client.redirect_uris.length === 1) {
                redirectUri = client.redirect_uris[0];
            } else {
                throw new errors.InvalidRequestError('redirect_uri must be specified when client has multiple registered URIs');
            }
        } catch (error) {
            return sendOAuthError(res, error);
        }

        var rawState = input && typeof input.state === 'string' ? input.state : undefined;
        if (rawState !== undefined && Buffer.from(rawState, 'utf8').toString('utf8') !== rawState) {
            return res.redirect(302, createErrorRedirect(
                redirectUri,
                new errors.InvalidRequestError('Invalid OAuth state encoding'),
                undefined
            ));
        }

        try {
            if (input && typeof input.response_type === 'string' && input.response_type !== 'code') {
                throw new errors.UnsupportedResponseTypeError('Only code responses are supported');
            }
            var reqParse = RequestAuthorizationParamsSchema.safeParse(input);
            if (!reqParse.success) throw new errors.InvalidRequestError(reqParse.error.message);
            await provider.authorize(client, {
                state: rawState,
                scopes: reqParse.data.scope !== undefined ? reqParse.data.scope.split(' ') : [],
                redirectUri: redirectUri,
                codeChallenge: reqParse.data.code_challenge,
                resource: reqParse.data.resource ? new URL(reqParse.data.resource) : undefined
            }, res);
        } catch (error) {
            var oauthErr = error instanceof errors.OAuthError ? error : new errors.ServerError('Internal Server Error');
            res.redirect(302, createErrorRedirect(redirectUri, oauthErr, rawState));
        }
    });
    return router;
}

var ClientAuthSchema = z.object({
    client_id: z.string(),
    client_secret: z.string().optional()
});

function authenticateClient(clientsStore, hashFn) {
    return async function (req, res, next) {
        try {
            var parsed = ClientAuthSchema.safeParse(req.body);
            if (!parsed.success) throw new errors.InvalidRequestError(String(parsed.error));
            var client = await clientsStore.getClient(parsed.data.client_id);
            if (!client) throw new errors.InvalidClientError('Invalid client_id');
            if (client.client_secret) {
                if (!parsed.data.client_secret) throw new errors.InvalidClientError('Client secret is required');
                if (!timingSafeTextEqual(client.client_secret, hashFn(parsed.data.client_secret))) {
                    throw new errors.InvalidClientError('Invalid client_secret');
                }
                if (client.client_secret_expires_at && client.client_secret_expires_at < Math.floor(Date.now() / 1000)) {
                    throw new errors.InvalidClientError('Client secret has expired');
                }
            }
            req.client = client;
            next();
        } catch (error) {
            sendOAuthError(res, error);
        }
    };
}

var TokenRequestSchema = z.object({ grant_type: z.string() });
var AuthCodeGrantSchema = z.object({
    code: z.string(),
    code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/, 'Invalid PKCE code_verifier'),
    redirect_uri: z.string().optional(),
    resource: z.string().refine(function (value) { return URL.canParse(value); }).optional()
});
var RefreshGrantSchema = z.object({
    refresh_token: z.string(),
    scope: z.string().optional(),
    resource: z.string().refine(function (value) { return URL.canParse(value); }).optional()
});

function createTokenHandler(options) {
    var provider = options.provider,
        hashFn = options.hash;
    var router = express.Router();
    router.use(allowedMethods(['POST']));
    router.use(authenticateClient(provider.clientsStore, hashFn));
    router.post('/', async function (req, res) {
        res.setHeader('Cache-Control', 'no-store');
        try {
            var base = TokenRequestSchema.safeParse(req.body);
            if (!base.success) throw new errors.InvalidRequestError(base.error.message);
            var client = req.client;
            if (!client) throw new errors.ServerError('Internal Server Error');

            if (base.data.grant_type === 'authorization_code') {
                var authGrant = AuthCodeGrantSchema.safeParse(req.body);
                if (!authGrant.success) throw new errors.InvalidRequestError(authGrant.error.message);
                var data = authGrant.data;
                var expectedChallenge = await provider.challengeForAuthorizationCode(client, data.code);
                var actualChallenge = crypto.createHash('sha256').update(data.code_verifier).digest('base64url');
                if (!timingSafeTextEqual(actualChallenge, expectedChallenge)) {
                    throw new errors.InvalidGrantError('code_verifier does not match the challenge');
                }
                var tokens = await provider.exchangeAuthorizationCode(
                    client, data.code, undefined, data.redirect_uri,
                    data.resource ? new URL(data.resource) : undefined
                );
                return res.status(200).json(tokens);
            }
            if (base.data.grant_type === 'refresh_token') {
                var refreshGrant = RefreshGrantSchema.safeParse(req.body);
                if (!refreshGrant.success) throw new errors.InvalidRequestError(refreshGrant.error.message);
                var rData = refreshGrant.data;
                var refreshed = await provider.exchangeRefreshToken(
                    client, rData.refresh_token, rData.scope ? rData.scope.split(' ') : undefined,
                    rData.resource ? new URL(rData.resource) : undefined
                );
                return res.status(200).json(refreshed);
            }
            throw new errors.UnsupportedGrantTypeError('The grant type is not supported by this authorization server.');
        } catch (error) {
            sendOAuthError(res, error);
        }
    });
    return router;
}

var RevocationRequestSchema = z.object({
    token: z.string(),
    token_type_hint: z.string().optional()
});

function createRevocationHandler(options) {
    var provider = options.provider,
        hashFn = options.hash;
    var router = express.Router();
    router.use(allowedMethods(['POST']));
    router.use(authenticateClient(provider.clientsStore, hashFn));
    router.post('/', async function (req, res) {
        res.setHeader('Cache-Control', 'no-store');
        try {
            var parsed = RevocationRequestSchema.safeParse(req.body);
            if (!parsed.success) throw new errors.InvalidRequestError(parsed.error.message);
            if (!req.client) throw new errors.ServerError('Internal Server Error');
            await provider.revokeToken(req.client, parsed.data);
            res.status(200).json({});
        } catch (error) {
            sendOAuthError(res, error);
        }
    });
    return router;
}

module.exports = {
    createRegistrationHandler: createRegistrationHandler,
    createAuthorizationHandler: createAuthorizationHandler,
    createTokenHandler: createTokenHandler,
    createRevocationHandler: createRevocationHandler
};
