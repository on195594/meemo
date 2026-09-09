'use strict';

var crypto = require('crypto'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    storage = require('../storage/local-storage.js'),
    things = require('./thing-service.js'),
    users = require('../users.js'),
    UserError = users.UserError;

function serviceError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function detectImageType(buffer) {
    if (!buffer || buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
    return null;
}

function safeExtension(detectedType) {
    if (detectedType === 'image/jpeg') return '.jpg';
    if (detectedType === 'image/png') return '.png';
    if (detectedType === 'image/gif') return '.gif';
    if (detectedType === 'image/webp') return '.webp';
    return '.bin';
}

function save(userId, file, callback) {
    var detectedType = detectImageType(file.buffer);
    var isImage = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
    var storageKey = crypto.randomUUID() + safeExtension(detectedType);
    var metadata = {
        identifier: storageKey,
        fileName: path.basename(file.originalname || 'attachment'),
        type: isImage ? things.TYPE_IMAGE : things.TYPE_UNKNOWN
    };

    storage.saveAttachment(userId, storageKey, file.buffer, function (error) {
        if (error) return callback(error);
        callback(null, metadata);
    });
}

function authorize(rawUserId, thingId, identifier, session, callback) {
    if (!ObjectId.isValid(thingId)) return callback(serviceError('not_found', 'not found'));

    users.resolveUser(rawUserId, function (resolveError, targetUser) {
        if (resolveError && resolveError.code !== UserError.NOT_FOUND) return callback(resolveError);

        var targetUserId = targetUser ? targetUser.id : rawUserId;
        var targetUsername = targetUser ? targetUser.username : rawUserId;

        things.get(targetUserId, thingId, function (error, thing) {
            if (error && error.message === 'not found' && targetUsername && targetUsername !== targetUserId) {
                return things.get(targetUsername, thingId, handleThing);
            }
            handleThing(error, thing);

            function handleThing(error, thing) {
                if (error && error.message === 'not found') return callback(serviceError('not_found', 'not found'));
                if (error) return callback(error);
                if (!thing) return callback(serviceError('not_found', 'not found'));

                var attachment = (Array.isArray(thing.attachments) ? thing.attachments : []).find(function (candidate) {
                    return candidate && candidate.identifier === identifier;
                });
                if (!attachment) return callback(serviceError('not_found', 'attachment not found'));

                var isOwner = session && (
                    (session.userId && (session.userId === targetUserId || session.userId === rawUserId)) ||
                    (session.username && (session.username === targetUsername || session.username === rawUserId))
                );
                if (!isOwner && !thing.public && !thing.shared) return callback(serviceError('forbidden', 'not allowed'));

                callback(null, {
                    attachment: attachment,
                    root: storage.resolveAttachmentRoot(targetUserId, targetUsername, identifier)
                });
            }
        });
    });
}

module.exports = {
    save: save,
    authorize: authorize,
    detectImageType: detectImageType,
    TYPE_IMAGE: things.TYPE_IMAGE
};
