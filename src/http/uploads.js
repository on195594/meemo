'use strict';

var multer = require('multer'),
    os = require('os'),
    responses = require('./responses.js');

function createUploadMiddleware(uploadInstance) {
    return function (req, res, next) {
        uploadInstance(req, res, function (err) {
            if (err) {
                if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
                    return next(new responses.HttpError(413, err.message || 'File limit exceeded'));
                }
                return next(new responses.HttpError(400, err.message || 'Upload failed'));
            }
            next();
        });
    };
}

function uploadLimits(fileSize) {
    return {
        fileSize: fileSize,
        files: 1,
        fields: 10,
        parts: 12,
        fieldNameSize: 100,
        fieldSize: 1024 * 1024,
        fieldNestingDepth: 0
    };
}

function createUploads() {
    var maxAttachmentSize = parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || (10 * 1024 * 1024);
    var maxImportSize = parseInt(process.env.MAX_IMPORT_SIZE, 10) || (50 * 1024 * 1024);

    return {
        attachmentUpload: createUploadMiddleware(multer({
            storage: multer.memoryStorage(),
            limits: uploadLimits(maxAttachmentSize)
        }).any()),
        importUpload: createUploadMiddleware(multer({
            dest: os.tmpdir(),
            limits: uploadLimits(maxImportSize)
        }).any())
    };
}

module.exports = {
    createUploads: createUploads,
    uploadLimits: uploadLimits
};
