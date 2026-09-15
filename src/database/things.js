/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js');

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

function ensureIndexes(callback) {
    var promise = Promise.resolve().then(function () {
        if (!config.db) throw new Error('MongoDB database is not connected');
        var collection = config.db.collection('things');
        return createIndex(collection, { ownerId: 1, modifiedAt: -1 })
            .then(function () { return createIndex(collection, { ownerId: 1, sticky: -1, modifiedAt: -1 }); })
            .then(function () { return createIndex(collection, { ownerId: 1, archived: 1, modifiedAt: -1 }); })
            .then(function () { return createIndex(collection, { ownerId: 1, tags: 1 }); });
    }).then(function () {
        indexesCreated = true;
    });
    return nodeify(promise, callback);
}

function postProcess(userId, thing) {
    if (!thing) return;
    thing._id = String(thing._id);
    if (!thing.ownerId) thing.ownerId = userId;
    thing.public = !!thing.public;
    thing.shared = !!thing.shared;
    thing.archived = !!thing.archived;
    thing.sticky = !!thing.sticky;
}

function getAll(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');

    var ownerCondition = { ownerId: userId };
    var unifiedQuery = Object.keys(query).length ? { $and: [ownerCondition, query] } : ownerCondition;
    var promise = getUnifiedCollection().find(unifiedQuery)
        .sort({ sticky: -1, modifiedAt: -1, _id: -1 })
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

function add(userId, content, tags, attachments, externalContent, callback) {
    return addFull(userId, content, tags, attachments, externalContent, Date.now(), Date.now(), callback);
}

function addFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, callback) {
    var promise = insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt).then(function (result) {
        return get(userId, result._id);
    });
    return nodeify(promise, callback);
}

function insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, callback) {
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
        sticky: false
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

function put(userId, thingId, content, tags, attachments, externalContent, isPublic, isShared, isArchived, isSticky, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return nodeify(Promise.reject(new Error('not found')), callback);

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
    resetCache: resetCache
};
