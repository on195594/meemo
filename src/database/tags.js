/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js'),
    users = require('../users.js');

var unifiedCollection = null;
var legacyCollections = {};
var indexesCreated = false;
var lastModifiedAt = 0;

function resetCache() {
    unifiedCollection = null;
    legacyCollections = {};
    indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    if (!unifiedCollection) unifiedCollection = config.db.collection('tags');
    if (!indexesCreated) {
        indexesCreated = true;
        ensureIndexes().catch(function (error) {
            indexesCreated = false;
            console.error('Warning: could not create tags indexes:', error);
        });
    }
    return unifiedCollection;
}

function ensureIndexes(callback) {
    var promise = Promise.resolve().then(function () {
        if (!config.db) throw new Error('MongoDB database is not connected');
        return config.db.collection('tags').createIndex({ ownerId: 1, name: 1 }, { unique: true });
    }).then(function () {
        indexesCreated = true;
    }).catch(function (error) {
        if (error.codeName === 'IndexOptionsConflict') {
            indexesCreated = true;
            return;
        }
        throw error;
    });
    return nodeify(promise, callback);
}

function getLegacyCollection(userId) {
    assert.strictEqual(typeof userId, 'string');
    if (!legacyCollections[userId]) legacyCollections[userId] = config.db.collection(userId + '_tags');
    return legacyCollections[userId];
}

async function getAlternateUserId(userId) {
    try {
        var user = await users.resolveUser(userId);
        if (user.id === userId && user.username && user.username !== userId) return user.username;
        if (user.username === userId && user.id && user.id !== userId) return user.id;
    } catch (error) {}
    return null;
}

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');

    var promise = getAlternateUserId(userId).then(async function (alternateUserId) {
        var userIds = alternateUserId ? [alternateUserId, userId] : [userId];
        var results = await Promise.all(userIds.map(function (id) {
            return getLegacyCollection(id).find({}).toArray();
        }).concat(userIds.map(function (id) {
            return getUnifiedCollection().find({ ownerId: id }).toArray();
        })));
        var byName = new Map();
        results.reduce(function (all, result) { return all.concat(result); }, []).forEach(function (tag) {
            byName.set(tag.name, tag);
        });
        return Array.from(byName.values()).sort(function (left, right) {
            return (right.usage || 0) - (left.usage || 0) || (right.createdAt || 0) - (left.createdAt || 0);
        });
    });
    return nodeify(promise, callback);
}

function update(userId, name, callback) {
    var promise = updateWithState(userId, name).then(function () { return undefined; });
    return nodeify(promise, callback);
}

function updateWithState(userId, name, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof name, 'string');

    var modifiedAt = Math.max(Date.now(), lastModifiedAt + 1);
    lastModifiedAt = modifiedAt;
    var promise = getUnifiedCollection().findOneAndUpdate({ ownerId: userId, name: name }, {
        $inc: { usage: 1 },
        $set: { ownerId: userId, name: name, modifiedAt: modifiedAt },
        $setOnInsert: { createdAt: modifiedAt }
    }, { upsert: true, returnDocument: 'before', includeResultMetadata: true }).then(function (result) {
        var previous = result.value;
        return {
            name: name,
            previous: previous,
            documentId: previous ? previous._id : result.lastErrorObject.upserted,
            modifiedAt: modifiedAt,
            expectedUsage: (previous && previous.usage || 0) + 1
        };
    });
    return nodeify(promise, callback);
}

function restoreUpdate(userId, state, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert(state && typeof state.name === 'string');

    var collection = getUnifiedCollection();
    var exactQuery = {
        _id: state.documentId,
        ownerId: userId,
        name: state.name,
        modifiedAt: state.modifiedAt,
        usage: state.expectedUsage
    };
    var promise;
    if (state.previous) {
        promise = collection.replaceOne(exactQuery, state.previous).then(function (result) {
            if (result.matchedCount) return;
            return collection.updateOne({ _id: state.documentId, ownerId: userId, usage: { $gt: 0 } }, { $inc: { usage: -1 } });
        });
    } else {
        promise = collection.deleteOne(exactQuery).then(function (result) {
            if (result.deletedCount) return;
            return collection.updateOne({ _id: state.documentId, ownerId: userId, usage: { $gt: 0 } }, { $inc: { usage: -1 } });
        });
    }
    return nodeify(promise, callback);
}

function del(userId, tagId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof tagId, 'string');
    if (!ObjectId.isValid(tagId)) return nodeify(Promise.reject(new Error('not found')), callback);

    var promise = getAlternateUserId(userId).then(async function (alternateUserId) {
        var id = new ObjectId(tagId);
        var query = alternateUserId ? { _id: id, $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { _id: id, ownerId: userId };
        await getUnifiedCollection().deleteOne(query);
        await getLegacyCollection(userId).deleteOne({ _id: id });
        if (alternateUserId) await getLegacyCollection(alternateUserId).deleteOne({ _id: id });
    });
    return nodeify(promise, callback);
}

module.exports = {
    get: get,
    del: del,
    update: update,
    updateWithState: updateWithState,
    restoreUpdate: restoreUpdate,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
