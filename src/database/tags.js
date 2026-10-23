/* jslint node:true */

'use strict';

/**
 * Unified tags collection projection repository.
 *
 * NOTE: As defined in docs/LONG_TERM_ARCHITECTURE.md (section 5, tag authority), the authoritative
 * online single source of truth for tag identity and usage is `things.tags` in MongoDB.
 * Runtime read operations (`/api/tags`) aggregate dynamically from `things` via `things.getTagUsage`.
 * This module and the persisted `tags` collection serve exclusively as a historical
 * migration projection and verification artifact (e.g. `cleanupTags` and readiness checks).
 */

var assert = require('assert'),
    crypto = require('crypto'),
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
    replaceAll: replaceAll,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache
};
