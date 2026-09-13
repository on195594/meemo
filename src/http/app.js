'use strict';

var express = require('express'),
    json = require('body-parser').json,
    config = require('../config.js'),
    cors = require('cors'),
    path = require('path'),
    serveStatic = require('serve-static'),
    createRouter = require('./router.js'),
    responses = require('./responses.js'),
    logger = require('./middleware/logger.js'),
    createSession = require('./session.js'),
    createUploads = require('./uploads.js').createUploads;

function createApp(options) {
    options = options || {};

    if (options.db) config.db = options.db;

    var app = express();
    var uploads = createUploads();
    var structuredLogger = options.logger || logger.defaultLogger;
    app.use(structuredLogger.middleware);

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

module.exports = createApp;
