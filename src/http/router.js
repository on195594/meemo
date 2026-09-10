'use strict';

var express = require('express'),
    path = require('path'),
    auth = require('./middleware/auth.js'),
    HttpError = require('./responses.js').HttpError,
    authRoutes = require('./routes/auth.js'),
    fileRoutes = require('./routes/files.js'),
    healthRoutes = require('./routes/health.js'),
    publicRoutes = require('./routes/public.js'),
    settingsRoutes = require('./routes/settings.js'),
    thingRoutes = require('./routes/things.js'),
    transferRoutes = require('./routes/transfer.js');

function createRouter(options) {
    var router = new express.Router();

    authRoutes.registerRoutes(router, auth);
    thingRoutes.registerRoutes(router, auth);
    fileRoutes.registerRoutes(router, auth, options.attachmentUpload);
    settingsRoutes.registerRoutes(router, auth);
    transferRoutes.registerRoutes(router, auth, options.importUpload);
    publicRoutes.registerRoutes(router);
    healthRoutes.registerRoutes(router);

    router.all('/api/*', function (req, res, next) {
        next(new HttpError(404, 'not found'));
    });

    router.get('*', function (req, res) {
        var indexPath = path.resolve(__dirname, '../../public/index.html');
        var hasFileExtension = path.extname(req.path) !== '';
        if (hasFileExtension) {
            return res.status(404).send('Not Found');
        }
        res.sendFile(indexPath, function (err) {
            if (err) {
                res.status(404).send('Not Found');
            }
        });
    });

    return router;
}

module.exports = createRouter;
