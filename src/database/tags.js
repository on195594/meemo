/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectID,
    config = require('../config.js'),
    nodeify = require('../promise.js'),
    users = require('../users.js');

var unifiedCollection = null;
var legacyCollections = {};
var indexesCreated = false;

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
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof name, 'string');

    var promise = getUnifiedCollection().updateOne({ ownerId: userId, name: name }, {
        $inc: { usage: 1 },
        $set: { ownerId: userId, name: name, modifiedAt: Date.now() },
        $setOnInsert: { createdAt: Date.now() }
    }, { upsert: true }).then(function () { return undefined; });
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
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
