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
    routes = require('./src/routes.js'),
    lastmile = require('connect-lastmile'),
    logic = require('./src/logic.js'),
    MongoClient = require('mongodb').MongoClient,
    morgan = require('morgan'),
    path = require('path'),
    serveStatic = require('serve-static');

function createApp(options) {
    options = options || {};

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
    var router = new express.Router();

    var storage = multer.diskStorage({});
    var diskUpload = multer({ storage: storage }).any();
    var memoryUpload = multer({ storage: multer.memoryStorage({}) }).any();

    router.del = router.delete;

    router.post('/api/register', routes.register);
    router.post('/api/login', routes.login);
    router.post('/api/logout', routes.logout);

    router.post('/api/things', routes.auth, routes.add);
    router.get ('/api/things', routes.auth, routes.getAll);
    router.get ('/api/things/:id', routes.auth, routes.get);
    router.put ('/api/things/:id', routes.auth, routes.put);
    router.del ('/api/things/:id', routes.auth, routes.del);

    router.post('/api/files', routes.auth, memoryUpload, routes.fileAdd);
    router.get ('/api/files/:userId/:thingId/:identifier', routes.fileGet);

    router.get ('/api/tags', routes.auth, routes.getTags);

    router.post('/api/settings', routes.auth, routes.settingsSave);
    router.get ('/api/settings', routes.auth, routes.settingsGet);

    router.get ('/api/export', routes.auth, routes.exportThings);
    router.post('/api/import', routes.auth, diskUpload, routes.importThings);

    router.get ('/api/profile', routes.auth, routes.profile);

    // public apis
    router.get ('/api/public/:userId/files/:fileId', routes.public.getFile);
    router.get ('/api/public/:userId/things', routes.public.getAll);
    router.get ('/api/public/:userId/things/:thingId', routes.public.getThing);
    router.get ('/api/rss/:userId', routes.public.getRSS);

    router.get ('/api/users', routes.public.users);
    router.get ('/api/users/:userId', routes.public.profile);

    router.get ('/api/health/live', routes.healthLive);
    router.get ('/api/health/ready', routes.healthReady);
    router.get ('/api/healthcheck', routes.healthcheck);

    // page overlay for pretty public streams
    router.get ('/public/:userId', routes.public.streamPage);

    // Add pretty 404 handler
    router.get ('*', function (req, res) {
        res.sendFile(path.resolve(__dirname, 'public/error.html'));
    });

    if (process.env.DEBUG) {
        app.use(morgan('dev', { immediate: false, stream: { write: function (str) { console.log(str.slice(0, -1)); } } }));
    }

    app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

    app.use(serveStatic(__dirname + '/public', { etag: false }));

    if (process.env.CORS_ORIGIN) {
        var allowedOrigins = process.env.CORS_ORIGIN.split(',').map(function (o) { return o.trim(); });
        app.use(cors({ origin: allowedOrigins, credentials: true }));
    }

    app.use(json({ strict: true, limit: '5mb' }));

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

    app.use(router);
    app.use(lastmile());

    return app;
}

function exit(error) {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
}

function startServer(options, callback) {
    options = options || {};
    var port = options.port || PORT;
    var bindAddress = options.bindAddress || BIND_ADDRESS;
    var databaseUrl = options.databaseUrl || config.databaseUrl;

    MongoClient.connect(databaseUrl, { useUnifiedTopology: true }, function (error, client) {
        if (error) {
            if (callback) return callback(error);
            exit(error);
        }

        // stash for database code to be used
        config.db = client.db();

        var app;
        try {
            app = createApp(options);
        } catch (err) {
            if (callback) return callback(err);
            exit(err);
        }

        var server = app.listen(port, bindAddress, function () {
            var host = server.address().address;
            var actualPort = server.address().port;

            console.log('App listening at http://%s:%s', host, actualPort);

            var cleanupInterval = setInterval(logic.cleanupTags, 1000 * 60);

            function shutdown(signal, done) {
                console.log('Received %s, starting graceful shutdown...', signal || 'shutdown');
                clearInterval(cleanupInterval);
                server.close(function () {
                    console.log('HTTP server closed');
                    client.close(false, function () {
                        console.log('MongoDB connection closed');
                        if (done) return done();
                        process.exit(0);
                    });
                });
            }

            process.on('SIGTERM', function () { shutdown('SIGTERM'); });
            process.on('SIGINT', function () { shutdown('SIGINT'); });

            var result = {
                app: app,
                server: server,
                client: client,
                close: function (done) {
                    shutdown('close', done);
                }
            };

            if (callback) callback(null, result);
        });
    });
}

if (require.main === module) {
    startServer();
}

module.exports = {
    createApp: createApp,
    startServer: startServer
};
