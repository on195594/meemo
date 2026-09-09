'use strict';

var config = require('../../config.js'),
    fs = require('fs'),
    logic = require('../../logic.js'),
    mkdirp = require('mkdirp'),
    path = require('path'),
    tar = require('tar-fs'),
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess;

function exportThings(req, res, next) {
    var userId = req.user.id;
    var username = req.user.username;
    var attachmentFolder = path.join(config.attachmentDir, userId);

    if (!fs.existsSync(attachmentFolder) && username && username !== userId && fs.existsSync(path.join(config.attachmentDir, username))) {
        attachmentFolder = path.join(config.attachmentDir, username);
    }
    mkdirp.sync(attachmentFolder);

    logic.exp(userId, function (error, result) {
        if (error && username && username !== userId) return logic.exp(username, sendArchive);
        sendArchive(error, result);

        function sendArchive(error, result) {
            if (error) return next(new HttpError(500, error));

            var out = tar.pack(attachmentFolder, {
                map: function (header) {
                    header.name = 'attachments/' + header.name;
                    return header;
                }
            });

            out.entry({ name: 'things.json' }, JSON.stringify(result, null, 4));
            res.attachment('meemo-export.tar');
            out.pipe(res);
        }
    });
}

function importThings(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.path) return next(new HttpError(400, 'missing file'));

    function cleanupTemp() {
        if (!fs.existsSync(file.path)) return;
        try { fs.unlinkSync(file.path); } catch (error) {}
    }

    logic.importThings(req.user.id, file.path, function (error, stats) {
        cleanupTemp();
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
