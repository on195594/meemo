'use strict';

var fs = require('fs'),
    multer = require('multer'),
    os = require('os'),
    path = require('path'),
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

function ensurePrivateUploadDir() {
    var owner = typeof process.geteuid === 'function' ? process.geteuid() : process.pid;
    var dir = path.join(os.tmpdir(), 'meemo-uploads-' + owner);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    return dir;
}

function createUploads() {
    var maxAttachmentSize = parseInt(process.env.MAX_ATTACHMENT_SIZE, 10) || (10 * 1024 * 1024);
    var maxImportSize = parseInt(process.env.MAX_IMPORT_SIZE, 10) || (50 * 1024 * 1024);
    var uploadDir = ensurePrivateUploadDir();

    return {
        attachmentUpload: createUploadMiddleware(multer({
            dest: uploadDir,
            limits: uploadLimits(maxAttachmentSize)
        }).any()),
        importUpload: createUploadMiddleware(multer({
            dest: uploadDir,
            limits: uploadLimits(maxImportSize)
        }).any())
    };
}

module.exports = {
    createUploads: createUploads,
    uploadLimits: uploadLimits
};
