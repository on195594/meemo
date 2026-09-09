'use strict';

var transfer = require('../../services/import-export-service.js'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function exportThings(req, res, next) {
    transfer.createExport(req.user.id, req.user.username, function (error, stream) {
        if (error) return next(new HttpError(500, error));
        res.attachment('meemo-export.tar');
        stream.pipe(res);
    });
}

function importThings(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.path) return next(new HttpError(400, 'missing file'));

    transfer.importUploadedArchive(req.user.id, file.path, function (error, stats) {
        if (error) {
            var message = typeof error === 'string' ? error : (error.message || 'Import failed');
            if (isArchiveValidationError(message)) return next(new HttpError(400, message));
            return next(new HttpError(500, error));
        }
        next(new HttpSuccess(200, stats || {}));
    });
}

function isArchiveValidationError(message) {
    return /^(Archive |Dangerous |Invalid archive|Path traversal|Schema validation|things\.json )/.test(message);
}

function registerRoutes(router, auth, upload) {
    router.get('/api/export', auth, exportThings);
    router.post('/api/import', auth, upload, importThings);
}

module.exports = {
    registerRoutes: registerRoutes,
    exportThings: exportThings,
    importThings: importThings
};
