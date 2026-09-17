/* jslint node:true */

'use strict';

/**
 * Unified tags collection projection repository.
 *
 * NOTE: As defined in docs/LONG_TERM_ARCHITECTURE.md (Section 10), the authoritative
 * online single source of truth for tag identity and usage is `things.tags` in MongoDB.
 * Runtime read operations (`/api/tags`) aggregate dynamically from `things` via `things.getTagUsage`.
 * This module and the persisted `tags` collection serve exclusively as a historical
 * migration projection and verification artifact (e.g. `cleanupTags` and readiness checks).
 * Direct mutation functions (update, del, etc.) are @deprecated and retained only for
 * legacy test suite backwards compatibility.
 */

var assert = require('assert'),
    crypto = require('crypto'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js');

var collectionDatabase = null;
var indexesCreated = false;
var lastModifiedAt = 0;

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
            console.error('Warning: could not create tags indexes:', error);
        });
    }
    return config.db.collection('tags');
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

/**
 * @deprecated Use things.getTagUsage(userId) for online tag usage queries.
 */
function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');

    var promise = getUnifiedCollection().find({ ownerId: userId }).toArray().then(function (result) {
        return result.sort(function (left, right) {
            return (right.usage || 0) - (left.usage || 0) || (right.createdAt || 0) - (left.createdAt || 0);
        });
    });
    return nodeify(promise, callback);
}

/**
 * @deprecated Retained for legacy migration test suites only. Online mutations update things.tags.
 */
function update(userId, name, callback) {
    var promise = updateWithState(userId, name).then(function () { return undefined; });
    return nodeify(promise, callback);
}

/**
 * @deprecated Retained for legacy migration test suites only.
 */
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

/**
 * @deprecated Retained for legacy migration test suites only.
 */
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

/**
 * @deprecated Retained for legacy migration test suites only.
 */
function del(userId, tagId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof tagId, 'string');
    if (!ObjectId.isValid(tagId)) return nodeify(Promise.reject(new Error('not found')), callback);

    var promise = getUnifiedCollection().deleteOne({ _id: new ObjectId(tagId), ownerId: userId }).then(function () {
        return undefined;
    });
    return nodeify(promise, callback);
}

function replaceAll(documents, callback) {
    assert(Array.isArray(documents));

    var promise = Promise.resolve().then(async function () {
        if (!config.db) throw new Error('MongoDB database is not connected');
        var temporaryName = '_tags_repair_' + crypto.randomUUID().replace(/-/g, '');
        var temporary = config.db.collection(temporaryName);
        try {
            await temporary.createIndex({ ownerId: 1, name: 1 }, { unique: true });
            if (documents.length) await temporary.insertMany(documents);
            await temporary.rename('tags', { dropTarget: true });
            collectionDatabase = config.db;
            indexesCreated = true;
        } catch (error) {
            try {
                await temporary.drop();
            } catch (cleanupError) {
                if (!cleanupError || cleanupError.code !== 26) {
                    error.message += '; temporary tag collection cleanup failed';
                }
            }
            throw error;
        }
    });
    return nodeify(promise, callback);
}

module.exports = {
    get: get,
    del: del,
    update: update,
    updateWithState: updateWithState,
    restoreUpdate: restoreUpdate,
    replaceAll: replaceAll,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
