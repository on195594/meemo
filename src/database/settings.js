/* jslint node:true */

'use strict';

var assert = require('assert'),
    config = require('../config.js'),
    nodeify = require('../promise.js');

var collectionDatabase = null;
var indexesCreated = false;

function resetCache() {
    collectionDatabase = null;
    indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    if (collectionDatabase !== config.db) {
        collectionDatabase = config.db;
        indexesCreated = false;
    }
    if (!indexesCreated) {
        indexesCreated = true;
        ensureIndexes().catch(function (error) {
            indexesCreated = false;
            console.error('Warning: could not create settings indexes:', error);
        });
    }
    return config.db.collection('settings');
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

    var promise = getUnifiedCollection().findOne({ ownerId: userId }).then(function (doc) {
        if (doc && typeof doc.value === 'object') return doc.value;
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
