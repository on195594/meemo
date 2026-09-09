/* jslint node:true */

'use strict';

exports = module.exports = {
    getAllActiveUserIds: getAllActiveUserIds,

    getAll: getAll,
    getAllLean: getAllLean,
    get: get,
    add: add,
    addFull: addFull,
    put: put,
    del: del,

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
var g_activeUserIds = {};
var g_indexesCreated = false;

function resetCache() {
    g_unifiedCollection = null;
    g_collections = {};
    g_activeUserIds = {};
    g_indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');

    if (!g_unifiedCollection) {
        g_unifiedCollection = config.db.collection('things');
    }

    if (!g_indexesCreated) {
        g_indexesCreated = true;
        ensureIndexes(function (err) {
            if (err) console.error('Warning: could not create things indexes:', err);
        });
    }

    return g_unifiedCollection;
}

function ensureIndexes(callback) {
    if (!config.db) {
        if (callback) return callback(new Error('MongoDB database is not connected'));
        return;
    }

    var collection = config.db.collection('things');

    collection.createIndex({ ownerId: 1, modifiedAt: -1 }, function (err1) {
        if (err1 && err1.codeName !== 'IndexOptionsConflict') {
            if (callback) return callback(err1);
        }

        collection.createIndex({ ownerId: 1, sticky: -1, modifiedAt: -1 }, function (err2) {
            if (err2 && err2.codeName !== 'IndexOptionsConflict') {
                if (callback) return callback(err2);
            }

            collection.createIndex({ ownerId: 1, archived: 1, modifiedAt: -1 }, function (err3) {
                if (err3 && err3.codeName !== 'IndexOptionsConflict') {
                    if (callback) return callback(err3);
                }

                collection.createIndex({ content: 'text' }, { default_language: 'none' }, function (err4) {
                    if (err4 && err4.codeName !== 'IndexOptionsConflict') {
                        if (callback) return callback(err4);
                    }
                    g_indexesCreated = true;
                    if (callback) callback(null);
                });
            });
        });
    });
}

function getLegacyCollection(userId) {
    assert.strictEqual(typeof userId, 'string');

    if (!g_collections[userId]) {
        g_collections[userId] = config.db.collection(userId + '_things');
    }

    return g_collections[userId];
}

function getAllActiveUserIds() {
    var ids = Object.keys(g_activeUserIds);
    var legacy = Object.keys(g_collections);
    var seen = {};
    return ids.concat(legacy).filter(function (id) {
        if (!seen[id]) {
            seen[id] = true;
            return true;
        }
        return false;
    });
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

function postProcess(userId, thing) {
    if (!thing) return;
    thing._id = String(thing._id);
    if (!thing.ownerId) {
        thing.ownerId = userId;
    }
    thing.public = !!thing.public;
    thing.shared = !!thing.shared;
    thing.archived = !!thing.archived;
    thing.sticky = !!thing.sticky;
}

function getAll(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');
    assert.strictEqual(typeof skip, 'number');
    assert.strictEqual(typeof limit, 'number');
    assert.strictEqual(typeof callback, 'function');

    g_activeUserIds[userId] = true;

    getAlternateUserId(userId, function (altErr, altUserId) {
        var ownerCondition = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };
        var unifiedQuery = (!query || Object.keys(query).length === 0) ? ownerCondition : { $and: [ownerCondition, query] };

        getUnifiedCollection().find(unifiedQuery).skip(skip).limit(limit).sort({ sticky: -1, modifiedAt: -1 }).toArray(function (error, result) {
            if (error) return callback(error);
            if (!result || result.length === 0) {
                // Fallback to legacy collection
                return getLegacyCollection(userId).find(query).skip(skip).limit(limit).sort({ sticky: -1, modifiedAt: -1 }).toArray(function (err2, res2) {
                    if (err2) return callback(err2);
                    if (!res2 || res2.length === 0) {
                        if (altUserId) {
                            return getLegacyCollection(altUserId).find(query).skip(skip).limit(limit).sort({ sticky: -1, modifiedAt: -1 }).toArray(function (err3, res3) {
                                if (err3) return callback(err3);
                                if (!res3) return callback(null, []);
                                res3.forEach(postProcess.bind(null, userId));
                                callback(null, res3);
                            });
                        }
                        return callback(null, []);
                    }
                    res2.forEach(postProcess.bind(null, userId));
                    callback(null, res2);
                });
            }

            result.forEach(postProcess.bind(null, userId));
            callback(null, result);
        });
    });
}

function getAllLean(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    g_activeUserIds[userId] = true;

    getAlternateUserId(userId, function (altErr, altUserId) {
        var ownerCondition = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };

        getUnifiedCollection().find(ownerCondition).sort({ modifiedAt: -1, sticky: 1 }).toArray(function (error, result) {
            if (error) return callback(error);
            if (!result || result.length === 0) {
                return getLegacyCollection(userId).find({}).sort({ modifiedAt: -1, sticky: 1 }).toArray(function (err2, res2) {
                    if (err2) return callback(err2);
                    if (!res2 || res2.length === 0) {
                        if (altUserId) {
                            return getLegacyCollection(altUserId).find({}).sort({ modifiedAt: -1, sticky: 1 }).toArray(function (err3, res3) {
                                if (err3) return callback(err3);
                                if (!res3) return callback(null, []);
                                res3.forEach(postProcess.bind(null, userId));
                                callback(null, res3);
                            });
                        }
                        return callback(null, []);
                    }
                    res2.forEach(postProcess.bind(null, userId));
                    callback(null, res2);
                });
            }

            result.forEach(postProcess.bind(null, userId));
            callback(null, result);
        });
    });
}

function get(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof callback, 'function');

    if (!ObjectId.isValid(thingId)) return callback(new Error('not found'));

    g_activeUserIds[userId] = true;

    getAlternateUserId(userId, function (altErr, altUserId) {
        var ownerCondition = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };
        var unifiedQuery = { $and: [{ _id: new ObjectId(thingId) }, ownerCondition] };

        getUnifiedCollection().findOne(unifiedQuery, function (error, doc) {
            if (error) return callback(error);
            if (doc) {
                postProcess(userId, doc);
                return callback(null, doc);
            }

            // Fallback to legacy collections
            getLegacyCollection(userId).findOne({ _id: new ObjectId(thingId) }, function (err2, res2) {
                if (err2) return callback(err2);
                if (res2) {
                    postProcess(userId, res2);
                    return callback(null, res2);
                }

                if (altUserId) {
                    getLegacyCollection(altUserId).findOne({ _id: new ObjectId(thingId) }, function (err3, res3) {
                        if (err3) return callback(err3);
                        if (!res3) return callback(new Error('not found'));

                        postProcess(userId, res3);
                        callback(null, res3);
                    });
                } else {
                    callback(new Error('not found'));
                }
            });
        });
    });
}

function add(userId, content, tags, attachments, externalContent, callback) {
    addFull(userId, content, tags, attachments, externalContent, Date.now(), Date.now(), callback);
}

function addFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof content, 'string');
    assert(Array.isArray(tags));
    assert(Array.isArray(attachments));
    assert(Array.isArray(externalContent));
    assert.strictEqual(typeof createdAt, 'number');
    assert.strictEqual(typeof modifiedAt, 'number');
    assert.strictEqual(typeof callback, 'function');

    g_activeUserIds[userId] = true;

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

    getUnifiedCollection().insertOne(doc, function (error, result) {
        if (error) return callback(error);
        if (!result) return callback(new Error('no result returned'));

        get(userId, result.insertedId.toString(), callback);
    });
}

function put(userId, thingId, content, tags, attachments, externalContent, isPublic, isShared, isArchived, isSticky, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof content, 'string');
    assert(Array.isArray(tags));
    assert(Array.isArray(attachments));
    assert(Array.isArray(externalContent));
    assert.strictEqual(typeof isPublic, 'boolean');
    assert.strictEqual(typeof isShared, 'boolean');
    assert.strictEqual(typeof isArchived, 'boolean');
    assert.strictEqual(typeof isSticky, 'boolean');
    assert.strictEqual(typeof callback, 'function');

    if (!ObjectId.isValid(thingId)) return callback(new Error('not found'));

    g_activeUserIds[userId] = true;

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

    getAlternateUserId(userId, function (altErr, altUserId) {
        var ownerCondition = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };
        var filter = { $and: [{ _id: new ObjectId(thingId) }, ownerCondition] };

        getUnifiedCollection().updateOne(filter, { $set: data }, function (error, res) {
            if (error) return callback(error);
            if (res && res.matchedCount > 0) {
                return get(userId, thingId, callback);
            }

            // Fallback to legacy collections
            getLegacyCollection(userId).updateOne({ _id: new ObjectId(thingId) }, { $set: data }, function (err2, res2) {
                if (err2) return callback(err2);
                if (res2 && res2.matchedCount > 0) {
                    return get(userId, thingId, callback);
                }

                if (altUserId) {
                    getLegacyCollection(altUserId).updateOne({ _id: new ObjectId(thingId) }, { $set: data }, function (err3) {
                        if (err3) return callback(err3);
                        get(userId, thingId, callback);
                    });
                } else {
                    get(userId, thingId, callback);
                }
            });
        });
    });
}

function del(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof callback, 'function');

    if (!ObjectId.isValid(thingId)) return callback(new Error('not found'));

    g_activeUserIds[userId] = true;

    getAlternateUserId(userId, function (altErr, altUserId) {
        var ownerCondition = altUserId ? { $or: [{ ownerId: userId }, { ownerId: altUserId }] } : { ownerId: userId };
        var filter = { $and: [{ _id: new ObjectId(thingId) }, ownerCondition] };

        getUnifiedCollection().deleteOne(filter, function (error) {
            if (error) return callback(error);

            // Also clean legacy collections if exists
            getLegacyCollection(userId).deleteOne({ _id: new ObjectId(thingId) }, function () {
                if (altUserId) {
                    getLegacyCollection(altUserId).deleteOne({ _id: new ObjectId(thingId) }, function () {
                        callback(null);
                    });
                } else {
                    callback(null);
                }
            });
        });
    });
}
