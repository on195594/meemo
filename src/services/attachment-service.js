'use strict';

var crypto = require('crypto'),
    config = require('../config.js'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    nodeify = require('../promise.js'),
    storage = require('../storage/local-storage.js'),
    things = require('./thing-service.js'),
    users = require('../users.js'),
    UserError = users.UserError;

var DEFAULT_GC_GRACE_MS = 24 * 60 * 60 * 1000;

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

function isSafePathSegment(segment) {
    return typeof segment === 'string' && segment && path.basename(segment) === segment && segment !== '.' && segment !== '..' && segment.indexOf('\0') === -1;
}

function addReference(references, root, identifier) {
    if (!isSafePathSegment(root)) throw new Error('Unsafe attachment root in database: ' + root);
    if (!isSafePathSegment(identifier)) throw new Error('Unsafe attachment identifier in database: ' + identifier);
    references.add(identifier);
}

async function scanReferences() {
    if (!config.db) throw new Error('MongoDB database is not connected');

    var collectionInfos = await config.db.listCollections({}, { nameOnly: true }).toArray();
    var collectionNames = (collectionInfos || []).map(function (collection) { return collection.name; }).filter(function (name) {
        return name === 'things' || name.slice(-7) === '_things';
    }).sort();
    // Identifiers are UUID storage keys. Treat a reference in any user root as
    // globally live so incomplete stable-ID/username mappings cannot cause loss.
    var references = new Set();
    for (var collectionName of collectionNames) {
        var legacyRoot = collectionName === 'things' ? null : collectionName.slice(0, -7);
        var documents = await config.db.collection(collectionName).find({}, { projection: { ownerId: 1, attachments: 1 } }).toArray();
        for (var document of documents) {
            if (document.attachments === undefined || document.attachments === null) continue;
            if (!Array.isArray(document.attachments)) throw new Error('Invalid attachments in database collection: ' + collectionName);
            if (!document.attachments.length) continue;
            var root = legacyRoot || (document.ownerId === undefined || document.ownerId === null ? '' : String(document.ownerId));
            if (!root) throw new Error('Missing attachment owner in database collection: ' + collectionName);
            document.attachments.forEach(function (attachment) {
                var identifier = typeof attachment === 'string' ? attachment : attachment && attachment.identifier;
                addReference(references, root, identifier);
            });
        }
    }
    return references;
}

function garbageCollect(options, callback) {
    options = options || {};
    var graceMs = options.graceMs === undefined ? DEFAULT_GC_GRACE_MS : Number(options.graceMs);
    var now = options.now === undefined ? Date.now() : Number(options.now);
    var apply = options.apply === true;
    var promise = Promise.resolve().then(async function () {
        if (!Number.isFinite(graceMs) || graceMs < 0) throw new Error('graceMs must be a non-negative number');
        if (!Number.isFinite(now)) throw new Error('now must be a number');

        // Finish both scans before any deletion so scan errors always fail closed.
        var references = await scanReferences();
        var files = await storage.listAttachments();
        var orphans = files.filter(function (file) {
            return !references.has(file.identifier);
        }).map(function (file) {
            var ageMs = now - file.mtimeMs;
            return Object.assign({}, file, { ageMs: ageMs, eligible: ageMs > graceMs });
        });
        var eligible = orphans.filter(function (file) { return file.eligible; });
        var deleted = 0;
        if (apply) {
            for (var file of eligible) {
                // Close the normal scan/delete race: a reference created while
                // candidates were enumerated protects the file before removal.
                var currentReferences = await scanReferences();
                if (currentReferences.has(file.identifier)) continue;
                await storage.removeFile(file.path);
                deleted += 1;
            }
        }
        return {
            mode: apply ? 'apply' : 'dry-run',
            gracePeriodMs: graceMs,
            filesScanned: files.length,
            orphansFound: orphans.length,
            eligibleForDeletion: eligible.length,
            deleted: deleted,
            orphans: orphans.map(function (file) {
                return { root: file.root, identifier: file.identifier, ageMs: file.ageMs, eligible: file.eligible };
            })
        };
    });
    return nodeify(promise, callback);
}

module.exports = {
    save: save,
    authorize: authorize,
    garbageCollect: garbageCollect,
    detectImageType: detectImageType,
    DEFAULT_GC_GRACE_MS: DEFAULT_GC_GRACE_MS,
    TYPE_IMAGE: things.TYPE_IMAGE
};
