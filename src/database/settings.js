/* jslint node:true */

'use strict';

var assert = require('assert'),
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
    if (!unifiedCollection) unifiedCollection = config.db.collection('settings');
    if (!indexesCreated) {
        indexesCreated = true;
        ensureIndexes().catch(function (error) {
            indexesCreated = false;
            console.error('Warning: could not create settings indexes:', error);
        });
    }
    return unifiedCollection;
}

function ensureIndexes(callback) {
    var promise = Promise.resolve().then(function () {
        if (!config.db) throw new Error('MongoDB database is not connected');
        return config.db.collection('settings').createIndex({ ownerId: 1 }, { unique: true });
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
    if (!legacyCollections[userId]) legacyCollections[userId] = config.db.collection(userId + '_settings');
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

function put(userId, value, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert(value && typeof value === 'object');

    var promise = getUnifiedCollection().updateOne({ ownerId: userId }, {
        $set: {
            ownerId: userId,
            type: 'frontend',
            value: value,
            modifiedAt: Date.now()
        }
    }, { upsert: true }).then(function () { return undefined; });
    return nodeify(promise, callback);
}

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');

    var promise = getAlternateUserId(userId).then(async function (alternateUserId) {
        var query = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        var doc = await getUnifiedCollection().findOne(query);
        if (doc && typeof doc.value === 'object') return doc.value;

        doc = await getLegacyCollection(userId).findOne({ type: 'frontend' });
        if (doc && typeof doc.value === 'object') return doc.value;
        if (alternateUserId) {
            doc = await getLegacyCollection(alternateUserId).findOne({ type: 'frontend' });
            if (doc && typeof doc.value === 'object') return doc.value;
        }
        return { title: 'Meemo' };
    });
    return nodeify(promise, callback);
}

module.exports = {
    get: get,
    put: put,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
