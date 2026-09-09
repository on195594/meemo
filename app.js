#!/usr/bin/env node

'use strict';

require('supererror')({ splatchError: true });

const PORT = process.env.VITE_DEV_PORT || process.env.PORT || 3000;
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';
const SESSION_SECRET = process.env.SESSION_SECRET || require('crypto').randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
    console.warn('SESSION_SECRET is not set. A random secret was generated for this process; existing sessions will be invalidated after restart.');
}

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

app.use(serveStatic(__dirname + '/public', { etag: false }));
app.use(cors());
app.use(json({ strict: true, limit: '5mb' }));
app.use(session({
    secret: SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
    cookie: { sameSite: 'strict' },
    store: MongoStore.create({ mongoUrl: config.databaseUrl })
}));

app.use(router);
app.use(lastmile());

function exit(error) {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
}

MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (error, client) {
    if (error) exit(error);

    // stash for database code to be used
    config.db = client.db();

    var server = app.listen(PORT, BIND_ADDRESS, function () {
        var host = server.address().address;
        var port = server.address().port;

        console.log('App listening at http://%s:%s', host, port);

        setInterval(logic.cleanupTags, 1000 * 60);
    });
});
