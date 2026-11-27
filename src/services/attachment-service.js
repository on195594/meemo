'use strict';

var crypto = require('crypto'),
    fs = require('fs').promises,
    config = require('../config.js'),
    ObjectId = require('mongodb').ObjectId,
    path = require('path'),
    isSafePathSegment = require('../path-segment.js'),
    storage = require('../storage/local-storage.js'),
    thingsDb = require('../database/things.js'),
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

async function readFileHeader(filePath) {
    var handle = await fs.open(filePath, 'r');
    try {
        var header = Buffer.alloc(12);
        var readResult = await handle.read(header, 0, 12, 0);
        return header.subarray(0, readResult.bytesRead);
    } finally {
        await handle.close();
    }
}

async function save(userId, file) {
    var detectedType;
    if (file.path) {
        try {
            detectedType = detectImageType(await readFileHeader(file.path));
            var isImageFromPath = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
            var keyFromPath = crypto.randomUUID() + safeExtension(detectedType);
            await storage.saveAttachmentFromPath(userId, keyFromPath, file.path);
            return {
                identifier: keyFromPath,
                fileName: path.basename(file.originalname || 'attachment'),
                type: isImageFromPath ? things.TYPE_IMAGE : things.TYPE_UNKNOWN
            };
        } finally {
            await fs.rm(file.path, { force: true }).catch(function () {});
        }
    }
    detectedType = detectImageType(file.buffer);
    var isImage = Boolean(detectedType && file.mimetype && file.mimetype.indexOf('image/') === 0);
    var storageKey = crypto.randomUUID() + safeExtension(detectedType);
    await storage.saveAttachment(userId, storageKey, file.buffer);
    return {
        identifier: storageKey,
        fileName: path.basename(file.originalname || 'attachment'),
        type: isImage ? things.TYPE_IMAGE : things.TYPE_UNKNOWN
    };
}

async function authorize(rawUserId, thingId, identifier, session) {
    try {
        if (!ObjectId.isValid(thingId)) throw serviceError('not_found', 'not found');

        var targetUserId, targetUsername;
        if (session && session.userId && (session.userId === rawUserId || session.username === rawUserId)) {
            targetUserId = session.userId;
            targetUsername = session.username || rawUserId;
        } else {
            var targetUser;
            try {
                targetUser = await users.resolveUser(rawUserId);
            } catch (error) {
                if (error.code !== UserError.NOT_FOUND) throw error;
            }
            targetUserId = targetUser ? targetUser.id : rawUserId;
            targetUsername = targetUser ? targetUser.username : rawUserId;
        }

        var thing;
        try {
            thing = await thingsDb.getAttachmentTarget(targetUserId, thingId);
        } catch (error) {
            if (error.message !== 'not found' || targetUsername === targetUserId) throw error;
            thing = await thingsDb.getAttachmentTarget(targetUsername, thingId);
        }

        var attachment = (Array.isArray(thing.attachments) ? thing.attachments : []).find(function (candidate) {
            return candidate && candidate.identifier === identifier;
        });
        if (!attachment) throw serviceError('not_found', 'attachment not found');

        var isOwner = !!(session && session.userId && (
            session.userId === targetUserId || session.userId === rawUserId ||
            (session.username && (session.username === targetUsername || session.username === rawUserId))
        ));
        if (!isOwner && !thing.public && !thing.shared) throw serviceError('forbidden', 'not allowed');

        return {
            attachment: attachment,
            visible: !!(thing.public || thing.shared),
            root: await storage.resolveAttachmentRoot(targetUserId, targetUsername, identifier)
        };
    } catch (error) {
        if (error.message === 'not found' && !error.code) throw serviceError('not_found', 'not found');
        throw error;
    }
}

function addReference(references, root, identifier) {
    if (!isSafePathSegment(root)) throw new Error('Unsafe attachment root in database: ' + root);
    if (!isSafePathSegment(identifier)) throw new Error('Unsafe attachment identifier in database: ' + identifier);
    references.add(identifier);
}

async function scanReferences() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    // Identifiers are UUID storage keys. Treat a reference in any user root as
    // globally live so incomplete stable-ID/username mappings cannot cause loss.
    var references = new Set();
    var cursor = config.db.collection('things').find({}, { projection: { ownerId: 1, attachments: 1 } });
    try {
        for await (var document of cursor) {
            if (document.attachments === undefined || document.attachments === null) continue;
            if (!Array.isArray(document.attachments)) throw new Error('Invalid attachments in database collection: things');
            if (!document.attachments.length) continue;
            var root = (document.ownerId === undefined || document.ownerId === null) ? '' : String(document.ownerId);
            if (!root) throw new Error('Missing attachment owner in database collection: things');
            document.attachments.forEach(function (attachment) {
                var identifier = typeof attachment === 'string' ? attachment : attachment && attachment.identifier;
                addReference(references, root, identifier);
            });
        }
    } finally {
        await cursor.close();
    }
    return references;
}

/** Check one candidate in `things`, including legacy string descriptors; DB failures abort GC. */
async function hasReference(identifier) {
    if (!config.db) throw new Error('MongoDB database is not connected');
    var reference = await config.db.collection('things').findOne({
        $or: [{ 'attachments.identifier': identifier }, { attachments: identifier }]
    }, { projection: { _id: 1 } });
    return !!reference;
}

async function garbageCollect(options) {
    options = options || {};
    var graceMs = options.graceMs === undefined ? DEFAULT_GC_GRACE_MS : Number(options.graceMs);
    var now = options.now === undefined ? Date.now() : Number(options.now);
    var apply = options.apply === true;
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
            // Recheck references created since enumeration without loading every document again.
            // This check and removal, as before, are not atomic with concurrent note writes.
            if (await hasReference(file.identifier)) continue;
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
}

module.exports = {
    save: save,
    authorize: authorize,
    garbageCollect: garbageCollect,
    detectImageType: detectImageType,
    TYPE_IMAGE: things.TYPE_IMAGE
};
