'use strict';

var health = require('../../services/health-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function live(req, res, next) {
    next(new HttpSuccess(200, { status: 'ok' }));
}

async function ready(req, res, next) {
    try {
        await health.ready();
    } catch (error) {
        throw new HttpError(503, error.message);
    }
    next(new HttpSuccess(200, { status: 'ready' }));
}

function healthcheck(req, res, next) {
    res.setHeader('X-Deprecated', '/api/healthcheck is deprecated, use /api/health/live or /api/health/ready');
    next(new HttpSuccess(200, {}));
}

function registerRoutes(router) {
    router.get('/api/health/live', live);
    router.get('/api/health/ready', asyncHandler(ready));
    router.get('/api/healthcheck', healthcheck);
}

module.exports = {
    registerRoutes: registerRoutes,
    live: live,
    ready: ready,
    healthcheck: healthcheck
};
