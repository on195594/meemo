'use strict';

var health = require('../../services/health-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function live(req, res, next) {
    next(new HttpSuccess(200, Object.assign({ status: 'ok' }, health.processStats())));
}

async function ready(req, res, next) {
    var stats;
    try {
        stats = await health.ready();
    } catch (error) {
        throw new HttpError(503, error.message);
    }
    next(new HttpSuccess(200, Object.assign({ status: 'ready' }, stats)));
}

function registerRoutes(router) {
    router.get('/api/health/live', live);
    router.get('/api/health/ready', asyncHandler(ready));
}

module.exports = {
    registerRoutes: registerRoutes,
    live: live,
    ready: ready
};
