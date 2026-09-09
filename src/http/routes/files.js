'use strict';

var config = require('../../config.js'),
    crypto = require('crypto'),
    fs = require('fs'),
    logic = require('../../logic.js'),
    mkdirp = require('mkdirp'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    users = require('../../users.js'),
    UserError = users.UserError,
    responses = require('../responses.js'),
    HttpError = responses.HttpError,
    HttpSuccess = responses.HttpSuccess,
    validation = require('../middleware/validate.js'),
    validate = validation.validate,
    z = validation.z;

var fileParams = z.object({
    userId: validation.safePathSegment,
    thingId: z.string().min(1),
    identifier: validation.safePathSegment
});

function detectImageType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
    return null;
}

function getSafeExtension(detectedType) {
    if (detectedType === 'image/jpeg') return '.jpg';
    if (detectedType === 'image/png') return '.png';
    if (detectedType === 'image/gif') return '.gif';
    if (detectedType === 'image/webp') return '.webp';
    return '.bin';
}

function add(req, res, next) {
    var file = req.file || (req.files && req.files[0]);
    if (!file || !file.buffer) return next(new HttpError(400, 'missing file'));

    var detectedType = detectImageType(file.buffer);
    var isImage = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
    var storageKey = crypto.randomUUID() + getSafeExtension(detectedType);
    var attachmentFolder = path.join(config.attachmentDir, req.user.id);
    var targetFilePath = path.join(attachmentFolder, storageKey);

    mkdirp.sync(attachmentFolder);
    fs.writeFile(targetFilePath, file.buffer, function (error) {
        if (error) {
            fs.unlink(targetFilePath, function () {});
            return next(new HttpError(500, error));
        }

        next(new HttpSuccess(201, {
            identifier: storageKey,
            fileName: path.basename(file.originalname || 'attachment'),
            type: isImage ? logic.TYPE_IMAGE : logic.TYPE_UNKNOWN
        }));
    });
}

function get(req, res, next) {
    var rawUserId = req.params.userId;
    var thingId = req.params.thingId;
    var identifier = req.params.identifier;

    if (!ObjectId.isValid(thingId)) return next(new HttpError(404, 'not found'));

    users.resolveUser(rawUserId, function (resolveErr, targetUser) {
        if (resolveErr && resolveErr.code === UserError.INTERNAL_ERROR) return next(new HttpError(500, resolveErr));

        var targetUserId = targetUser ? targetUser.id : rawUserId;
        var targetUsername = targetUser ? targetUser.username : rawUserId;

        logic.get(targetUserId, thingId, function (error, thing) {
            if (error && error.message === 'not found' && targetUsername && targetUsername !== targetUserId) {
                return logic.get(targetUsername, thingId, onGotThing);
            }
            onGotThing(error, thing);

            function onGotThing(error, thing) {
                if (error && error.message === 'not found') return next(new HttpError(404, 'not found'));
                if (error) return next(new HttpError(500, error));
                if (!thing) return next(new HttpError(404, 'not found'));

                var attachments = Array.isArray(thing.attachments) ? thing.attachments : [];
                var attachment = attachments.find(function (candidate) {
                    return candidate && candidate.identifier === identifier;
                });

                if (!attachment) return next(new HttpError(404, 'attachment not found'));

                var isOwner = req.session && (
                    (req.session.userId && (req.session.userId === targetUserId || req.session.userId === rawUserId)) ||
                    (req.session.username && (req.session.username === targetUsername || req.session.username === rawUserId))
                );

                if (!isOwner && !thing.public && !thing.shared) {
                    return next(new HttpError(403, 'not allowed'));
                }

                var userRoot = path.join(config.attachmentDir, targetUserId);
                if (!fs.existsSync(path.join(userRoot, identifier)) && targetUsername && targetUsername !== targetUserId) {
                    var legacyRoot = path.join(config.attachmentDir, targetUsername);
                    if (fs.existsSync(path.join(legacyRoot, identifier))) userRoot = legacyRoot;
                }

                res.setHeader('X-Content-Type-Options', 'nosniff');
                if (attachment.type !== logic.TYPE_IMAGE) {
                    res.setHeader('Content-Disposition', 'attachment; filename="' + encodeURIComponent(attachment.fileName || 'attachment') + '"');
                }
                res.sendFile(identifier, { root: userRoot }, function (sendError) {
                    if (sendError && !res.headersSent) return next(new HttpError(404, 'file not found'));
                });
            }
        });
    });
}

function registerRoutes(router, auth, upload) {
    router.post('/api/files', auth, upload, add);
    router.get('/api/files/:userId/:thingId/:identifier', validate({ params: fileParams }), get);
}

module.exports = {
    registerRoutes: registerRoutes,
    add: add,
    get: get,
    detectImageType: detectImageType,
    schema: fileParams
};
