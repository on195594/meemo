/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js'),
    users = require('../users.js');

var unifiedCollection = null;
var legacyCollections = {};
var activeUserIds = {};
var indexesCreated = false;

function resetCache() {
    unifiedCollection = null;
    legacyCollections = {};
    activeUserIds = {};
    indexesCreated = false;
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    if (!unifiedCollection) unifiedCollection = config.db.collection('things');

    if (!indexesCreated) {
        indexesCreated = true;
        ensureIndexes().catch(function (error) {
            indexesCreated = false;
            console.error('Warning: could not create things indexes:', error);
        });
    }
    return unifiedCollection;
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
            .then(function () { return createIndex(collection, { ownerId: 1, tags: 1 }); })
            .then(function () { return createIndex(collection, { content: 'text' }, { default_language: 'none' }); });
    }).then(function () {
        indexesCreated = true;
    });
    return nodeify(promise, callback);
}

function getLegacyCollection(userId) {
    assert.strictEqual(typeof userId, 'string');
    if (!legacyCollections[userId]) legacyCollections[userId] = config.db.collection(userId + '_things');
    return legacyCollections[userId];
}

function getAllActiveUserIds(callback) {
    var promise = Promise.resolve().then(async function () {
        var seen = {};
        Object.keys(activeUserIds).concat(Object.keys(legacyCollections)).forEach(function (id) {
            seen[id] = true;
        });

        if (config.db) {
            try {
                var dbUserIds = await getUnifiedCollection().distinct('ownerId');
                (dbUserIds || []).forEach(function (id) {
                    if (id) seen[id] = true;
                });
                var cols = await config.db.listCollections().toArray();
                (cols || []).forEach(function (col) {
                    if (col.name && col.name.endsWith('_things')) {
                        var legacyId = col.name.slice(0, -7);
                        if (legacyId) seen[legacyId] = true;
                    }
                });
            } catch (err) {
                // DB not connected or indexing error
            }
        }

        return Object.keys(seen);
    });
    return nodeify(promise, callback);
}

async function getAlternateUserId(userId) {
    try {
        var user = await users.resolveUser(userId);
        if (user.id === userId && user.username && user.username !== userId) return user.username;
        if (user.username === userId && user.id && user.id !== userId) return user.id;
    } catch (error) {}
    return null;
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

function queryLegacy(userId, alternateUserId, query) {
    var userIds = alternateUserId ? [userId, alternateUserId] : [userId];
    return Promise.all(userIds.map(function (id) {
        var collectionName = id + '_things';
        return config.db.listCollections({ name: collectionName }, { nameOnly: true }).hasNext().then(function (exists) {
            if (!exists) return [];
            return getLegacyCollection(id).find(query).toArray();
        });
    })).then(function (results) {
        return results.reduce(function (all, result) { return all.concat(result); }, []);
    });
}

function mergeThings(unified, legacy, unifiedIdentities) {
    var byId = {};
    var unifiedIds = {};
    (unifiedIdentities || unified).forEach(function (thing) {
        unifiedIds[String(thing._id)] = true;
    });
    legacy.filter(function (thing) {
        return !unifiedIds[String(thing._id)];
    }).concat(unified).forEach(function (thing) {
        byId[String(thing._id)] = thing;
    });
    return Object.keys(byId).map(function (id) { return byId[id]; });
}

function sortAndPaginate(result, skip, limit, lean) {
    result.sort(function (left, right) {
        var modifiedOrder = (right.modifiedAt || 0) - (left.modifiedAt || 0);
        var stickyOrder = Number(!!right.sticky) - Number(!!left.sticky);
        return lean ? modifiedOrder || -stickyOrder : stickyOrder || modifiedOrder;
    });
    return result.slice(skip, limit > 0 ? skip + limit : undefined);
}

function getAll(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');
    activeUserIds[userId] = true;

    var promise = getAlternateUserId(userId).then(function (alternateUserId) {
        var ownerCondition = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        var unifiedQuery = Object.keys(query).length ? { $and: [ownerCondition, query] } : ownerCondition;
        return Promise.all([
            getUnifiedCollection().find(unifiedQuery).toArray(),
            getUnifiedCollection().find(ownerCondition).project({ _id: 1 }).toArray(),
            queryLegacy(userId, alternateUserId, query)
        ]).then(function (results) {
            return sortAndPaginate(mergeThings(results[0], results[2], results[1]), skip, limit, false);
        });
    }).then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
    return nodeify(promise, callback);
}

function getAllLean(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    activeUserIds[userId] = true;

    var promise = getAlternateUserId(userId).then(function (alternateUserId) {
        var ownerCondition = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        return Promise.all([
            getUnifiedCollection().find(ownerCondition).toArray(),
            queryLegacy(userId, alternateUserId, {})
        ]).then(function (results) {
            return sortAndPaginate(mergeThings(results[0], results[1]), 0, 0, true);
        });
    }).then(function (result) {
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
        var alternateUserId = await getAlternateUserId(userId);
        var ownerCondition = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        var id = new ObjectId(thingId);
        var result = await getUnifiedCollection().findOne({ $and: [{ _id: id }, ownerCondition] });
        if (!result) result = await getLegacyCollection(userId).findOne({ _id: id });
        if (!result && alternateUserId) result = await getLegacyCollection(alternateUserId).findOne({ _id: id });
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
        if (!result) {
            var activeIds = await getAllActiveUserIds();
            for (var i = 0; i < activeIds.length; i++) {
                result = await getLegacyCollection(activeIds[i]).findOne({ _id: id });
                if (result) {
                    result.ownerId = result.ownerId || activeIds[i];
                    break;
                }
            }
        }
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

    var promise = getAlternateUserId(userId).then(async function (alternateUserId) {
        var id = new ObjectId(thingId);
        var ownerCondition = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        var result = await getUnifiedCollection().updateOne({ $and: [{ _id: id }, ownerCondition] }, { $set: data });
        if (!result || !result.matchedCount) {
            result = await getLegacyCollection(userId).updateOne({ _id: id }, { $set: data });
            if ((!result || !result.matchedCount) && alternateUserId) {
                await getLegacyCollection(alternateUserId).updateOne({ _id: id }, { $set: data });
            }
        }
        return get(userId, thingId);
    });
    return nodeify(promise, callback);
}

function del(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return nodeify(Promise.reject(new Error('not found')), callback);
    activeUserIds[userId] = true;

    var promise = getAlternateUserId(userId).then(async function (alternateUserId) {
        var id = new ObjectId(thingId);
        var ownerCondition = alternateUserId ? { $or: [{ ownerId: userId }, { ownerId: alternateUserId }] } : { ownerId: userId };
        await getUnifiedCollection().deleteOne({ $and: [{ _id: id }, ownerCondition] });
        await getLegacyCollection(userId).deleteOne({ _id: id });
        if (alternateUserId) await getLegacyCollection(alternateUserId).deleteOne({ _id: id });
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
