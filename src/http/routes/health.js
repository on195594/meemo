'use strict';

var config = require('../../config.js'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function live(req, res, next) {
    next(new HttpSuccess(200, { status: 'ok' }));
}

function ready(req, res, next) {
    if (!config.db) return next(new HttpError(503, 'Database not connected'));

    config.db.command({ ping: 1 }, function (error) {
        if (error) return next(new HttpError(503, 'Database ping failed'));

        try {
            mkdirp.sync(config.attachmentDir);
            fs.accessSync(config.attachmentDir, fs.constants.R_OK | fs.constants.W_OK);
            next(new HttpSuccess(200, { status: 'ready' }));
        } catch (storageError) {
            next(new HttpError(503, 'Attachment directory not accessible'));
        }
    });
}

function healthcheck(req, res, next) {
    res.setHeader('X-Deprecated', '/api/healthcheck is deprecated, use /api/health/live or /api/health/ready');
    next(new HttpSuccess(200, {}));
}

function registerRoutes(router) {
    router.get('/api/health/live', live);
    router.get('/api/health/ready', ready);
    router.get('/api/healthcheck', healthcheck);
}

module.exports = {
    registerRoutes: registerRoutes,
    live: live,
    ready: ready,
    healthcheck: healthcheck
};
