'use strict';

var express = require('express'),
    json = require('body-parser').json,
    config = require('../config.js'),
    cors = require('cors'),
    path = require('path'),
    serveStatic = require('serve-static'),
    zlib = require('zlib'),
    createRouter = require('./router.js'),
    responses = require('./responses.js'),
    logger = require('./middleware/logger.js'),
    createSession = require('./session.js'),
    createUploads = require('./uploads.js').createUploads;

function createApp(options) {
    options = options || {};

    var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
    var authUserSource = options.authUserSource || process.env.AUTH_USER_SOURCE || (isProduction ? 'mongo' : 'file');
    if (isProduction && authUserSource !== 'mongo') {
        throw new Error('FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production');
    }

    if (options.db) config.db = options.db;

    var app = express();
    var uploads = createUploads();
    var structuredLogger = options.logger || logger.defaultLogger;
    app.use(structuredLogger.middleware);

    app.use(gzipMiddleware);

    var trustProxyEnv = process.env.TRUST_PROXY;
    if (trustProxyEnv === 'true' || trustProxyEnv === '1') {
        app.set('trust proxy', true);
    } else if (trustProxyEnv === 'false' || trustProxyEnv === '0') {
        app.set('trust proxy', false);
    } else if (trustProxyEnv) {
        app.set('trust proxy', trustProxyEnv);
    } else {
        app.set('trust proxy', ['loopback', 'uniquelocal']);
    }

    app.use(serveStatic(path.join(__dirname, '../../public'), {
        etag: true,
        lastModified: true,
        setHeaders: function (res, filePath) {
            var rel = path.relative(path.join(__dirname, '../../public'), filePath);
            if (filePath.endsWith('.html')) {
                res.setHeader('Cache-Control', 'no-cache');
            } else if (rel.startsWith('assets' + path.sep) || (res.req && res.req.path && res.req.path.startsWith('/assets/'))) {
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            }
        }
    }));

    if (process.env.CORS_ORIGIN) {
        var allowedOrigins = process.env.CORS_ORIGIN.split(',').map(function (origin) { return origin.trim(); });
        app.use(cors({ origin: allowedOrigins, credentials: true }));
    }

    app.use(json({ strict: true, limit: '5mb' }));

    app.use('/api/health/ready', function (req, res, next) {
        if (options.shutdownManager && options.shutdownManager.isShuttingDown) {
            return next(new responses.HttpError(503, 'Service is shutting down'));
        }
        next();
    });

    app.use(createSession(options));
    app.use(createRouter(uploads));
    app.use(responses.errorHandler);

    return app;
}

function gzipMiddleware(req, res, next) {
    if (typeof res.vary === 'function') res.vary('Accept-Encoding');
    if (!req.acceptsEncodings || !req.acceptsEncodings('gzip')) return next();

    var originalSend = res.send;
    res.send = function (body) {
        if (res.headersSent) return originalSend.call(res, body);

        var isBuffer = Buffer.isBuffer(body);
        var isString = typeof body === 'string';
        if (!isBuffer && !isString && typeof body === 'object' && body !== null) {
            body = JSON.stringify(body);
            isString = true;
            if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
            }
        } else if (isString && !res.getHeader('Content-Type')) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
        }

        var byteLength = isBuffer ? body.length : (isString ? Buffer.byteLength(body) : 0);
        if (byteLength < 1024) {
            return originalSend.call(res, body);
        }

        var contentType = String(res.getHeader('Content-Type') || '');
        if (!/json|text|javascript|css|xml|html/i.test(contentType)) {
            return originalSend.call(res, body);
        }

        zlib.gzip(body, function (err, compressed) {
            if (err) return originalSend.call(res, body);
            res.removeHeader('Content-Length');
            res.setHeader('Content-Encoding', 'gzip');
            originalSend.call(res, compressed);
        });
    };
    next();
}

createApp.gzipMiddleware = gzipMiddleware;

module.exports = createApp;
