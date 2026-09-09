/* jslint node:true */

'use strict';

exports = module.exports = {
    get: get,
    put: put,

    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};

var assert = require('assert'),
    config = require('../config.js'),
    users = require('../users.js');

var g_unifiedCollection = null;
var g_collections = {};
var g_indexesCreated = false;

function resetCache() {
    g_unifiedCollection = null;
    g_collections = {};
    g_indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');

    if (!g_unifiedCollection) {
        g_unifiedCollection = config.db.collection('settings');
    }

    if (!g_indexesCreated) {
        g_indexesCreated = true;
        ensureIndexes(function (err) {
            if (err && err.codeName !== 'IndexOptionsConflict') {
                console.error('Warning: could not create settings indexes:', err);
            }
        });
    }

    return g_unifiedCollection;
}

function ensureIndexes(callback) {
    if (!config.db) {
        if (callback) return callback(new Error('MongoDB database is not connected'));
        return;
    }

    var collection = config.db.collection('settings');
    collection.createIndex({ ownerId: 1 }, { unique: true }, function (err) {
        if (err && err.codeName !== 'IndexOptionsConflict') {
            if (callback) return callback(err);
        }
        g_indexesCreated = true;
        if (callback) callback(null);
    });
}

function getLegacyCollection(userId) {
    assert.strictEqual(typeof userId, 'string');

    if (!g_collections[userId]) {
        g_collections[userId] = config.db.collection(userId + '_settings');
    }

    return g_collections[userId];
}

function getAlternateUserId(userId, callback) {
    if (!users || typeof users.resolveUser !== 'function') return callback(null, null);
    users.resolveUser(userId, function (err, user) {
        if (err || !user) return callback(null, null);
        if (user.id === userId && user.username && user.username !== userId) {
            return callback(null, user.username);
        }
        if (user.username === userId && user.id && user.id !== userId) {
            return callback(null, user.id);
        }
        return callback(null, null);
    });
}

function put(userId, settings, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof settings, 'object');
    assert.strictEqual(typeof callback, 'function');

    var filter = { ownerId: userId };
    var updateDoc = {
        $set: {
            ownerId: userId,
            type: 'frontend',
            value: settings,
            modifiedAt: Date.now()
        }
    };

    getUnifiedCollection().updateOne(filter, updateDoc, { upsert: true }, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    getAlternateUserId(userId, function (altErr, altUserId) {
        var query = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };

        getUnifiedCollection().findOne(query, function (error, doc) {
            if (error) return callback(error);
            if (doc && typeof doc.value === 'object') {
                return callback(null, doc.value);
            }

            // Fallback to legacy collection
            getLegacyCollection(userId).findOne({ type: 'frontend' }, function (err2, legacyDoc) {
                if (err2) return callback(err2);
                if (legacyDoc && typeof legacyDoc.value === 'object') {
                    return callback(null, legacyDoc.value);
                }

                if (altUserId) {
                    getLegacyCollection(altUserId).findOne({ type: 'frontend' }, function (err3, altDoc) {
                        if (err3) return callback(err3);
                        if (altDoc && typeof altDoc.value === 'object') {
                            return callback(null, altDoc.value);
                        }
                        callback(null, { title: 'Meemo' });
                    });
                } else {
                    callback(null, { title: 'Meemo' });
                }
            });
        });
    });
}
