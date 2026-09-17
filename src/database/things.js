/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js'),
    noteColors = require('../note-colors.js');

var indexesCreated = false;
var WRITE_GATE_ID = 'thing-writes';
var WRITE_GATE_COLLECTION = 'system_maintenance';

function writeGateCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    return config.db.collection(WRITE_GATE_COLLECTION);
}

function writeFrozenError() {
    return new Error('Thing writes are frozen for maintenance');
}

async function checkNotFrozen() {
    if (!config.db) return;
    var gate = await writeGateCollection().findOne({ _id: WRITE_GATE_ID });
    if (gate && gate.frozen === true) {
        throw writeFrozenError();
    }
}

// ponytail: check maintenance gate without active-writer lease counters; no lock contention or crash deadlocks.
function acquireWriteFreeze(callback) {
    var promise = Promise.resolve().then(async function () {
        await writeGateCollection().updateOne(
            { _id: WRITE_GATE_ID },
            { $set: { frozen: true, frozenAt: Date.now() } },
            { upsert: true }
        );
    });
    return nodeify(promise, callback);
}

function releaseWriteFreeze(callback) {
    var promise = Promise.resolve().then(async function () {
        var result = await writeGateCollection().updateOne(
            { _id: WRITE_GATE_ID, frozen: true },
            { $set: { frozen: false, releasedAt: Date.now() } }
        );
        if (result.matchedCount !== 1) throw new Error('Thing write freeze is not active');
    });
    return nodeify(promise, callback);
}

function requireWriteFreeze(db, callback) {
    if (typeof db === 'function') {
        callback = db;
        db = null;
    }
    db = db || config.db;
    var promise = Promise.resolve().then(async function () {
        if (!db) throw new Error('MongoDB database is not connected');
        var gate = await db.collection(WRITE_GATE_COLLECTION).findOne({ _id: WRITE_GATE_ID });
        if (!gate || gate.frozen !== true) {
            throw new Error('A verified Thing write freeze is required');
        }
    });
    return nodeify(promise, callback);
}

function resetCache() {
    indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    return config.db.collection('things');
}

function createIndex(collection, spec, options) {
    return collection.createIndex(spec, options).catch(function (error) {
        if (error.codeName !== 'IndexOptionsConflict') throw error;
    });
}

async function ensureTextIndex(collection) {
    var TARGET_NAME = 'owner_text_content_tags';
    var TARGET_SPEC = { ownerId: 1, content: 'text', tags: 'text' };
    var TARGET_OPTIONS = { name: TARGET_NAME, weights: { tags: 10, content: 5 } };

    if (typeof collection.indexes !== 'function') {
        return collection.createIndex(TARGET_SPEC, TARGET_OPTIONS);
    }

    var indexes = await collection.indexes().catch(function () { return []; });
    var existingTextIndex = indexes.find(function (idx) {
        if (!idx.key) return false;
        return Object.values(idx.key).some(function (val) { return val === 'text'; });
    });

    if (existingTextIndex) {
        var isTarget = existingTextIndex.name === TARGET_NAME &&
            existingTextIndex.key &&
            existingTextIndex.key.ownerId === 1 &&
            existingTextIndex.weights &&
            existingTextIndex.weights.tags &&
            existingTextIndex.weights.content;

        if (isTarget) {
            return;
        }
        if (typeof collection.dropIndex === 'function') {
            await collection.dropIndex(existingTextIndex.name);
        }
    }

    await collection.createIndex(TARGET_SPEC, TARGET_OPTIONS);
}

function ensureIndexes(callback) {
    var promise = Promise.resolve().then(async function () {
        if (!config.db) throw new Error('MongoDB database is not connected');
        var collection = config.db.collection('things');
        await Promise.all([
            createIndex(collection, { ownerId: 1, modifiedAt: -1 }),
            createIndex(collection, { ownerId: 1, sticky: -1, modifiedAt: -1 }),
            createIndex(collection, { ownerId: 1, archived: 1, modifiedAt: -1 }),
            createIndex(collection, { ownerId: 1, tags: 1 }),
            createIndex(collection, { ownerId: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }),
            createIndex(collection, { ownerId: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 })
        ]);
        await ensureTextIndex(collection);
    }).then(function () {
        indexesCreated = true;
    });
    return nodeify(promise, callback);
}

function queryHasText(query) {
    if (!query || typeof query !== 'object') return false;
    if (query.$text) return true;
    if (Array.isArray(query.$and)) return query.$and.some(queryHasText);
    if (Array.isArray(query.$or)) return query.$or.some(queryHasText);
    return false;
}

function postProcess(userId, thing) {
    if (!thing) return;
    thing._id = String(thing._id);
    if (!thing.ownerId) thing.ownerId = userId;
    thing.public = !!thing.public;
    thing.shared = !!thing.shared;
    thing.archived = !!thing.archived;
    thing.sticky = !!thing.sticky;
    thing.color = noteColors.normalizeNoteColor(thing.color);
}

function getAll(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');

    var ownerCondition = { ownerId: userId };
    var unifiedQuery = Object.keys(query).length ? { $and: [ownerCondition, query] } : ownerCondition;
    var hasText = queryHasText(unifiedQuery);
    var cursor = getUnifiedCollection().find(unifiedQuery);

    if (hasText) {
        cursor = cursor.project({ score: { $meta: 'textScore' } })
            .sort({ sticky: -1, score: { $meta: 'textScore' }, modifiedAt: -1, _id: -1 });
    } else {
        cursor = cursor.sort({ sticky: -1, modifiedAt: -1, _id: -1 });
    }

    var promise = cursor
        .skip(skip)
        .limit(limit)
        .toArray().then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
    return nodeify(promise, callback);
}

function getAllLean(userId, callback) {
    assert.strictEqual(typeof userId, 'string');

    var promise = getUnifiedCollection().find({ ownerId: userId })
        .sort({ modifiedAt: -1, _id: -1 })
        .toArray().then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
    return nodeify(promise, callback);
}

function getTagUsage(userId, callback) {
    assert.strictEqual(typeof userId, 'string');

    var promise = getUnifiedCollection().aggregate([
        { $match: { ownerId: userId } },
        { $project: { tags: 1, _id: 0 } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', usage: { $sum: 1 } } },
        { $sort: { usage: -1, _id: 1 } }
    ]).toArray().then(function (result) {
        return (result || []).map(function (tag) {
            return { ownerId: userId, name: tag._id, usage: tag.usage };
        });
    });
    return nodeify(promise, callback);
}

function get(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');

    var promise = Promise.resolve().then(async function () {
        if (!ObjectId.isValid(thingId)) throw new Error('not found');
        var id = new ObjectId(thingId);
        var result = await getUnifiedCollection().findOne({ _id: id, ownerId: userId });
        if (!result) throw new Error('not found');
        postProcess(userId, result);
        return result;
    });
    return nodeify(promise, callback);
}

function getById(thingId, callback) {
    assert.strictEqual(typeof thingId, 'string');

    var promise = Promise.resolve().then(async function () {
        if (!ObjectId.isValid(thingId)) throw new Error('not found');
        var id = new ObjectId(thingId);
        var result = await getUnifiedCollection().findOne({ _id: id });
        if (!result) throw new Error('not found');
        postProcess(result.ownerId, result);
        return result;
    });
    return nodeify(promise, callback);
}

function add(userId, content, tags, attachments, externalContent, color, callback) {
    if (typeof color === 'function') {
        callback = color;
        color = 'default';
    }
    return addFull(userId, content, tags, attachments, externalContent, Date.now(), Date.now(), color, callback);
}

function addFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color, callback) {
    if (typeof color === 'function') {
        callback = color;
        color = 'default';
    }
    var promise = insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color).then(function (result) {
        return get(userId, result._id);
    });
    return nodeify(promise, callback);
}

function insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color, callback) {
    if (typeof color === 'function') {
        callback = color;
        color = 'default';
    }
    if (color === undefined) color = 'default';
    if (!noteColors.isValidNoteColor(color)) {
        return nodeify(Promise.reject(noteColors.invalidNoteColorError()), callback);
    }

    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof content, 'string');
    assert(Array.isArray(tags));
    assert(Array.isArray(attachments));
    assert(Array.isArray(externalContent));

    var doc = {
        ownerId: userId,
        content: content,
        createdAt: createdAt,
        modifiedAt: modifiedAt,
        tags: tags,
        externalContent: externalContent,
        attachments: attachments,
        public: false,
        shared: false,
        archived: false,
        sticky: false,
        color: color
    };

    var promise = Promise.resolve().then(async function () {
        await checkNotFrozen();
        var result = await getUnifiedCollection().insertOne(doc);
        if (!result) throw new Error('no result returned');
        doc._id = result.insertedId.toString();
        postProcess(userId, doc);
        return doc;
    });
    return nodeify(promise, callback);
}

function put(userId, thingId, content, tags, attachments, externalContent, isPublic, isShared, isArchived, isSticky, color, callback) {
    if (typeof color === 'function') {
        callback = color;
        color = undefined;
    }
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return nodeify(Promise.reject(new Error('not found')), callback);
    if (color !== undefined && !noteColors.isValidNoteColor(color)) {
        return nodeify(Promise.reject(noteColors.invalidNoteColorError()), callback);
    }

    var data = {
        ownerId: userId,
        content: content,
        tags: tags,
        modifiedAt: Date.now(),
        externalContent: externalContent,
        attachments: attachments,
        public: isPublic,
        shared: isShared,
        archived: isArchived,
        sticky: isSticky
    };
    if (typeof color === 'string') {
        data.color = color;
    }

    var promise = Promise.resolve().then(async function () {
        await checkNotFrozen();
        var id = new ObjectId(thingId);
        var result = await getUnifiedCollection().findOneAndUpdate(
            { _id: id, ownerId: userId },
            { $set: data },
            { returnDocument: 'after', includeResultMetadata: false }
        );
        if (!result) throw new Error('not found');
        postProcess(userId, result);
        return result;
    });
    return nodeify(promise, callback);
}

function del(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return nodeify(Promise.reject(new Error('not found')), callback);

    var promise = Promise.resolve().then(async function () {
        await checkNotFrozen();
        var id = new ObjectId(thingId);
        var result = await getUnifiedCollection().deleteOne({ _id: id, ownerId: userId });
        if (result.deletedCount === 0) throw new Error('not found');
    });
    return nodeify(promise, callback);
}

module.exports = {
    getAll: getAll,
    getAllLean: getAllLean,
    getTagUsage: getTagUsage,
    get: get,
    getById: getById,
    add: add,
    addFull: addFull,
    insertFull: insertFull,
    put: put,
    del: del,
    acquireWriteFreeze: acquireWriteFreeze,
    releaseWriteFreeze: releaseWriteFreeze,
    requireWriteFreeze: requireWriteFreeze,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache,
    queryHasText: queryHasText
};
