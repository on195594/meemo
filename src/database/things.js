/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js');

var activeUserIds = {};
var indexesCreated = false;

function resetCache() {
    activeUserIds = {};
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

function getAllActiveUserIds(callback) {
    var promise = Promise.resolve().then(async function () {
        var seen = {};
        Object.keys(activeUserIds).forEach(function (id) {
            seen[id] = true;
        });

        if (config.db) {
            try {
                var dbUserIds = await getUnifiedCollection().distinct('ownerId');
                (dbUserIds || []).forEach(function (id) {
                    if (id) seen[id] = true;
                });
            } catch (err) {
                // DB not connected or indexing error
            }
        }

        return Object.keys(seen);
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
    activeUserIds[userId] = true;

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
    activeUserIds[userId] = true;

    var promise = getUnifiedCollection().find({ ownerId: userId })
        .sort({ modifiedAt: -1, _id: -1 })
        .toArray().then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
    return nodeify(promise, callback);
}

function get(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');

    var promise = Promise.resolve().then(async function () {
        if (!ObjectId.isValid(thingId)) throw new Error('not found');
        activeUserIds[userId] = true;
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
    activeUserIds[userId] = true;

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

    var promise = getUnifiedCollection().insertOne(doc).then(function (result) {
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
    activeUserIds[userId] = true;

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
        var id = new ObjectId(thingId);
        await getUnifiedCollection().updateOne({ _id: id, ownerId: userId }, { $set: data });
        return get(userId, thingId);
    });
    return nodeify(promise, callback);
}

function del(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return nodeify(Promise.reject(new Error('not found')), callback);
    activeUserIds[userId] = true;

    var promise = Promise.resolve().then(async function () {
        var id = new ObjectId(thingId);
        await getUnifiedCollection().deleteOne({ _id: id, ownerId: userId });
    });
    return nodeify(promise, callback);
}

module.exports = {
    getAllActiveUserIds: getAllActiveUserIds,
    getAll: getAll,
    getAllLean: getAllLean,
    get: get,
    getById: getById,
    add: add,
    addFull: addFull,
    insertFull: insertFull,
    put: put,
    del: del,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
