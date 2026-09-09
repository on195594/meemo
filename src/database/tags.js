/* jslint node:true */

'use strict';

exports = module.exports = {
    get: get,
    del: del,
    update: update,

    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectID,
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
        g_unifiedCollection = config.db.collection('tags');
    }

    if (!g_indexesCreated) {
        g_indexesCreated = true;
        ensureIndexes(function (err) {
            if (err && err.codeName !== 'IndexOptionsConflict') {
                console.error('Warning: could not create tags indexes:', err);
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

    var collection = config.db.collection('tags');
    collection.createIndex({ ownerId: 1, name: 1 }, { unique: true }, function (err) {
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
        g_collections[userId] = config.db.collection(userId + '_tags');
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

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    getAlternateUserId(userId, function (altErr, altUserId) {
        var query = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };

        getUnifiedCollection().find(query).sort({ usage: -1, createdAt: -1 }).toArray(function (error, result) {
            if (error) return callback(error);
            if (!result || result.length === 0) {
                // Fallback to legacy collection
                return getLegacyCollection(userId).find({}).sort({ createdAt: -1 }).toArray(function (err2, legacyResult) {
                    if (err2) return callback(err2);
                    if (!legacyResult || legacyResult.length === 0) {
                        if (altUserId) {
                            return getLegacyCollection(altUserId).find({}).sort({ createdAt: -1 }).toArray(function (err3, altResult) {
                                if (err3) return callback(err3);
                                callback(null, altResult || []);
                            });
                        }
                        return callback(null, []);
                    }
                    callback(null, legacyResult);
                });
            }
            callback(null, result);
        });
    });
}

function update(userId, name, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof name, 'string');
    assert.strictEqual(typeof callback, 'function');

    var filter = { ownerId: userId, name: name };
    var updateDoc = {
        $inc: { usage: 1 },
        $set: {
            ownerId: userId,
            name: name,
            modifiedAt: Date.now()
        },
        $setOnInsert: {
            createdAt: Date.now()
        }
    };

    getUnifiedCollection().updateOne(filter, updateDoc, { upsert: true }, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}

function del(userId, tagId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof tagId, 'string');
    assert.strictEqual(typeof callback, 'function');

    if (!ObjectId.isValid(tagId)) return callback(new Error('not found'));

    getAlternateUserId(userId, function (altErr, altUserId) {
        var query = altUserId ? { _id: new ObjectId(tagId), $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { _id: new ObjectId(tagId), ownerId: userId };

        getUnifiedCollection().deleteOne(query, function (error) {
            if (error) return callback(error);

            // Also clean legacy collection if present
            getLegacyCollection(userId).deleteOne({ _id: new ObjectId(tagId) }, function () {
                if (altUserId) {
                    getLegacyCollection(altUserId).deleteOne({ _id: new ObjectId(tagId) }, function () {
                        callback(null);
                    });
                } else {
                    callback(null);
                }
            });
        });
    });
}
