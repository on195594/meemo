'use strict';

var rateLimit = require('express-rate-limit').rateLimit,
    transfer = require('../../services/import-export-service.js'),
    asyncHandler = require('../middleware/async-handler.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

var transferRateLimit = rateLimit({
    windowMs: 60000,
    limit: function () { return parseInt(process.env.TRANSFER_RATE_LIMIT_MAX, 10) || 60; },
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: function (req, res, next) {
        next(new HttpError(429, 'Too many requests. Please try again later.'));
    }
});

async function exportThings(req, res) {
    var stream = await transfer.createExport(req.user.id, req.user.username);
    res.attachment('meemo-export.tar');
    stream.pipe(res);
}

async function importThings(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.path) throw new HttpError(400, 'missing file');

    try {
        next(new HttpSuccess(200, await transfer.importUploadedArchive(req.user.id, file.path)));
    } catch (error) {
        var message = typeof error === 'string' ? error : (error.message || 'Import failed');
        if (isArchiveValidationError(message)) throw new HttpError(400, message);
        throw error;
    }
}

function isArchiveValidationError(message) {
    return /^(Archive |Dangerous |Invalid archive|Path traversal|Schema validation|things\.json )/.test(message);
}

function registerRoutes(router, auth, upload) {
    router.get('/api/export', auth, transferRateLimit, asyncHandler(exportThings));
    router.post('/api/import', auth, transferRateLimit, upload, asyncHandler(importThings));
}

module.exports = {
    registerRoutes: registerRoutes
};
