/* jslint node:true */

'use strict';

var assert = require('assert'),
    config = require('../config.js');

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

async function ensureIndexes() {
    try {
        if (!config.db) throw new Error('MongoDB database is not connected');
        await config.db.collection('settings').createIndex({ ownerId: 1 }, { unique: true });
        indexesCreated = true;
    } catch (error) {
        if (error.codeName === 'IndexOptionsConflict') {
            indexesCreated = true;
            return;
        }
        throw error;
    }
}

async function put(userId, value) {
    assert.strictEqual(typeof userId, 'string');
    assert(value && typeof value === 'object');

    return getUnifiedCollection().updateOne({ ownerId: userId }, {
        $set: {
            ownerId: userId,
            type: 'frontend',
            value: value,
            modifiedAt: Date.now()
        }
    }, { upsert: true }).then(function () { return undefined; });
}

async function get(userId) {
    assert.strictEqual(typeof userId, 'string');

    return getUnifiedCollection().findOne({ ownerId: userId }).then(function (doc) {
        if (doc && typeof doc.value === 'object') return doc.value;
        return { title: 'Meemo' };
    });
}

module.exports = {
    get: get,
    put: put,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
