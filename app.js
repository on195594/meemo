#!/usr/bin/env node

'use strict';

require('supererror')({ splatchError: true });

const PORT = process.env.VITE_DEV_PORT || process.env.PORT || 3000;
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

var express = require('express'),
    json = require('body-parser').json,
    config = require('./src/config.js'),
    cors = require('cors'),
    session = require('express-session'),
    MongoStore = require('connect-mongo'),
    multer  = require('multer'),
    createRouter = require('./src/http/router.js'),
    responses = require('./src/http/responses.js'),
    thingService = require('./src/services/thing-service.js'),
    lifecycle = require('./src/lifecycle.js'),
    things = require('./src/database/things.js'),
    tags = require('./src/database/tags.js'),
    settings = require('./src/database/settings.js'),
    nodeify = require('./src/promise.js'),
    os = require('os'),
    serveStatic = require('serve-static'),
    logger = require('./src/http/middleware/logger.js');

function createApp(options) {
    options = options || {};

    if (options.db) {
        config.db = options.db;
    }
    var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
    var sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;

    if (!sessionSecret) {
        if (isProduction) {
            throw new Error('FATAL: SESSION_SECRET is required when NODE_ENV=production');
        }
        sessionSecret = require('crypto').randomBytes(32).toString('hex');
        console.warn('SESSION_SECRET is not set. A random secret was generated for this process; existing sessions will be invalidated after restart.');
    }

    var app = express();

    var maxAttachmentSize = parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || (10 * 1024 * 1024);
    var maxImportSize = parseInt(process.env.MAX_IMPORT_SIZE, 10) || (50 * 1024 * 1024);

    function createUploadMiddleware(uploadInstance) {
        return function (req, res, next) {
            uploadInstance(req, res, function (err) {
                if (err) {
                    if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
                        return next(new responses.HttpError(413, err.message || 'File limit exceeded'));
                    }
                    return next(new responses.HttpError(400, err.message || 'Upload failed'));
                }
                next();
            });
        };
    }

    function uploadLimits(fileSize) {
        return {
            fileSize: fileSize,
            files: 1,
            fields: 10,
            parts: 12,
            fieldNameSize: 100,
            fieldSize: 1024 * 1024,
            fieldNestingDepth: 0
        };
    }

    var memoryUpload = createUploadMiddleware(multer({
        storage: multer.memoryStorage(),
        limits: uploadLimits(maxAttachmentSize)
    }).any());

    var diskUpload = createUploadMiddleware(multer({
        dest: os.tmpdir(),
        limits: uploadLimits(maxImportSize)
    }).any());

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

    app.use(serveStatic(__dirname + '/public', { etag: false }));

    if (process.env.CORS_ORIGIN) {
        var allowedOrigins = process.env.CORS_ORIGIN.split(',').map(function (o) { return o.trim(); });
        app.use(cors({ origin: allowedOrigins, credentials: true }));
    }

    app.use(json({ strict: true, limit: '5mb' }));

    app.use('/api/health/ready', function (req, res, next) {
        if (options.shutdownManager && options.shutdownManager.isShuttingDown) {
            return next(new responses.HttpError(503, 'Service is shutting down'));
        }
        next();
    });

    var sessionStore;
    if (options.sessionStore) {
        sessionStore = options.sessionStore;
    } else if (options.sessionMemory) {
        sessionStore = undefined;
    } else {
        sessionStore = MongoStore.create({ mongoUrl: options.databaseUrl || config.databaseUrl });
    }

    var secureCookie = isProduction && Boolean(process.env.APP_ORIGIN && process.env.APP_ORIGIN.indexOf('https://') === 0);

    app.use(session({
        secret: sessionSecret,
        saveUninitialized: false,
        resave: false,
        cookie: {
            sameSite: 'strict',
            httpOnly: true,
            secure: secureCookie
        },
        store: sessionStore
    }));

    app.use(createRouter({
        attachmentUpload: memoryUpload,
        importUpload: diskUpload
    }));
    app.use(responses.errorHandler);

    return app;
}

function exit(error) {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
}

function startServer(options, callback) {
    options = options || {};

    var promise = Promise.resolve().then(async function () {
        var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
        var sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
        if (isProduction && !sessionSecret) {
            throw new Error('FATAL: SESSION_SECRET is required when NODE_ENV=production');
        }

        var databaseManager = new lifecycle.DatabaseManager();
        var workerManager = new lifecycle.WorkerManager();
        var shutdownManager = new lifecycle.ShutdownManager({
            databaseManager: databaseManager,
            workerManager: workerManager,
            timeoutMs: options.shutdownTimeoutMs
        });
        var cleanupIntervalMs = options.tagCleanupIntervalMs || parseInt(process.env.TAG_CLEANUP_INTERVAL_MS, 10) || (1000 * 60);
        workerManager.register('cleanupTags', thingService.cleanupTags, cleanupIntervalMs);

        var connection = await databaseManager.connect(options);
        await Promise.all([
            things.ensureIndexes(),
            tags.ensureIndexes(),
            settings.ensureIndexes()
        ]);

        var app = createApp(Object.assign({}, options, { shutdownManager: shutdownManager }));
        var port = options.port !== undefined ? options.port : PORT;
        var bindAddress = options.bindAddress || BIND_ADDRESS;
        var server = await new Promise(function (resolve, reject) {
            var listener = app.listen(port, bindAddress, function () {
                listener.removeListener('error', reject);
                resolve(listener);
            });
            listener.once('error', reject);
        });

        console.log('App listening at http://%s:%s', server.address().address, server.address().port);
        shutdownManager.trackServer(server);
        var enableWorkers = options.enableWorkers !== undefined ? options.enableWorkers : (process.env.ENABLE_WORKERS !== 'false');
        if (enableWorkers) workerManager.start();
        if (options.autoAttachSignals !== false) shutdownManager.attachSignals();

        return {
            app: app,
            server: server,
            client: connection.client,
            db: connection.db,
            workers: workerManager,
            databaseManager: databaseManager,
            shutdownManager: shutdownManager,
            close: function (done) { return shutdownManager.shutdown('close', done); }
        };
    });

    return nodeify(promise, callback);
}

if (require.main === module) startServer().catch(exit);

module.exports = {
    createApp: createApp,
    startServer: startServer,
    lifecycle: lifecycle
};
