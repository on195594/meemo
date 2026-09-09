'use strict';

var crypto = require('crypto'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    nodeify = require('../promise.js'),
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
    var promise = Promise.resolve().then(async function () {
        var detectedType = detectImageType(file.buffer);
        var isImage = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
        var storageKey = crypto.randomUUID() + safeExtension(detectedType);
        await storage.saveAttachment(userId, storageKey, file.buffer);
        return {
            identifier: storageKey,
            fileName: path.basename(file.originalname || 'attachment'),
            type: isImage ? things.TYPE_IMAGE : things.TYPE_UNKNOWN
        };
    });
    return nodeify(promise, callback);
}

function authorize(rawUserId, thingId, identifier, session, callback) {
    var promise = Promise.resolve().then(async function () {
        if (!ObjectId.isValid(thingId)) throw serviceError('not_found', 'not found');

        var targetUser;
        try {
            targetUser = await users.resolveUser(rawUserId);
        } catch (error) {
            if (error.code !== UserError.NOT_FOUND) throw error;
        }

        var targetUserId = targetUser ? targetUser.id : rawUserId;
        var targetUsername = targetUser ? targetUser.username : rawUserId;
        var thing;
        try {
            thing = await things.get(targetUserId, thingId);
        } catch (error) {
            if (error.message !== 'not found' || targetUsername === targetUserId) throw error;
            thing = await things.get(targetUsername, thingId);
        }

        var attachment = (Array.isArray(thing.attachments) ? thing.attachments : []).find(function (candidate) {
            return candidate && candidate.identifier === identifier;
        });
        if (!attachment) throw serviceError('not_found', 'attachment not found');

        var isOwner = session && (
            (session.userId && (session.userId === targetUserId || session.userId === rawUserId)) ||
            (session.username && (session.username === targetUsername || session.username === rawUserId))
        );
        if (!isOwner && !thing.public && !thing.shared) throw serviceError('forbidden', 'not allowed');

        return {
            attachment: attachment,
            root: await storage.resolveAttachmentRoot(targetUserId, targetUsername, identifier)
        };
    }).catch(function (error) {
        if (error.message === 'not found' && !error.code) throw serviceError('not_found', 'not found');
        throw error;
    });
    return nodeify(promise, callback);
}

module.exports = {
    save: save,
    authorize: authorize,
    detectImageType: detectImageType,
    TYPE_IMAGE: things.TYPE_IMAGE
};
