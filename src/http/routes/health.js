'use strict';

var health = require('../../services/health-service.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function live(req, res, next) {
    next(new HttpSuccess(200, { status: 'ok' }));
}

function ready(req, res, next) {
    health.ready(function (error) {
        if (error) return next(new HttpError(503, error.message));
        next(new HttpSuccess(200, { status: 'ready' }));
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
