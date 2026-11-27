/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    noteColors = require('../note-colors.js');

var MAX_REVISION = Number.MAX_SAFE_INTEGER;

function revisionError(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
}

function requireRevision(expectedRevision, incrementsRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
        throw revisionError('precondition_required', 'expectedRevision is required');
    }
    if (incrementsRevision && expectedRevision >= MAX_REVISION) {
        throw revisionError('revision_overflow', 'Thing revision limit reached');
    }
}

function notFoundError() {
    return new Error('not found');
}

function conflictError() {
    return revisionError('revision_conflict', 'Thing revision conflict');
}

function resetCache() {
    // Kept for test isolation hooks that reset database handles between suites.
}

function getUnifiedCollection() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    return config.db.collection('things');
}

function createIndex(collection, spec, options) {
    return collection.createIndex(spec, options).catch(function (error) {
        if (error.codeName !== 'IndexOptionsConflict') throw error;
    });
}

async function ensureTextIndex(collection) {
    var TARGET_NAME = 'owner_text_content_tags';
    var TARGET_SPEC = { ownerId: 1, content: 'text', tags: 'text' };
    var TARGET_OPTIONS = { name: TARGET_NAME, weights: { tags: 10, content: 5 } };

    if (typeof collection.indexes !== 'function') {
        return collection.createIndex(TARGET_SPEC, TARGET_OPTIONS);
    }

    var indexes = await collection.indexes().catch(function () { return []; });
    var existingTextIndex = indexes.find(function (idx) {
        if (!idx.key) return false;
        return Object.values(idx.key).some(function (val) { return val === 'text'; });
    });

    if (existingTextIndex) {
        var isTarget = existingTextIndex.name === TARGET_NAME &&
            existingTextIndex.key &&
            existingTextIndex.key.ownerId === 1 &&
            existingTextIndex.weights &&
            existingTextIndex.weights.tags === 10 &&
            existingTextIndex.weights.content === 5;

        if (isTarget) {
            return;
        }
        if (typeof collection.dropIndex === 'function') {
            await collection.dropIndex(existingTextIndex.name).catch(function (err) {
                if (err && (err.codeName === 'IndexNotFound' || err.code === 27 || /index not found/i.test(err.message))) {
                    return;
                }
                throw err;
            });
        }
    }

    try {
        await collection.createIndex(TARGET_SPEC, TARGET_OPTIONS);
    } catch (err) {
        if (err && (err.codeName === 'IndexOptionsConflict' || err.code === 85 || err.codeName === 'IndexKeySpecsConflict')) {
            var refreshed = await collection.indexes().catch(function () { return []; });
            var targetMatch = refreshed.find(function (idx) {
                return idx.name === TARGET_NAME &&
                    idx.key && idx.key.ownerId === 1 &&
                    idx.weights && idx.weights.tags === 10 && idx.weights.content === 5;
            });
            if (targetMatch) return;
        }
        throw err;
    }
}

async function ensureIndexes() {
    if (!config.db) throw new Error('MongoDB database is not connected');
    var collection = config.db.collection('things');
    var configCol = typeof config.db.collection === 'function' ? config.db.collection('system_config') : null;
    var backfilled = configCol && typeof configCol.findOne === 'function'
        ? await configCol.findOne({ _id: 'things-archived-backfilled' }).catch(function () { return null; })
        : null;
    if (!backfilled) {
        await collection.updateMany({ archived: { $exists: false } }, { $set: { archived: false } });
        if (configCol && typeof configCol.updateOne === 'function') {
            await configCol.updateOne(
                { _id: 'things-archived-backfilled' },
                { $setOnInsert: { completedAt: Date.now() } },
                { upsert: true }
            ).catch(function () {});
        }
    }
    await Promise.all([
        createIndex(collection, { ownerId: 1, modifiedAt: -1 }),
        createIndex(collection, { ownerId: 1, deletedAt: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }),
        createIndex(collection, { ownerId: 1, deletedAt: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }),
        createIndex(collection, { 'attachments.identifier': 1 }, { sparse: true })
    ]);
    await ensureTextIndex(collection);
}

function queryHasText(query) {
    if (!query || typeof query !== 'object') return false;
    if (query.$text) return true;
    if (Array.isArray(query.$and)) return query.$and.some(queryHasText);
    if (Array.isArray(query.$or)) return query.$or.some(queryHasText);
    return false;
}

function queryHasDeleted(query) {
    if (!query || typeof query !== 'object') return false;
    if (Object.prototype.hasOwnProperty.call(query, 'deletedAt')) return true;
    if (Array.isArray(query.$and)) return query.$and.some(queryHasDeleted);
    if (Array.isArray(query.$or)) return query.$or.some(queryHasDeleted);
    return false;
}

function postProcess(userId, thing) {
    if (!thing) return;
    thing._id = String(thing._id);
    if (!thing.ownerId) thing.ownerId = userId;
    if (!Number.isSafeInteger(thing.revision) || thing.revision < 1) thing.revision = 1;
    thing.public = !!thing.public;
    thing.shared = !!thing.shared;
    thing.archived = !!thing.archived;
    thing.sticky = !!thing.sticky;
    thing.color = noteColors.normalizeNoteColor(thing.color);
}

function normalizeQueryForIndex(condition) {
    if (!condition || typeof condition !== 'object') return condition;
    if (Array.isArray(condition)) return condition.map(normalizeQueryForIndex);
    if (Array.isArray(condition.$or) && condition.$or.length === 2) {
        var hasFalse = condition.$or.some(function (c) { return c && c.archived === false; });
        var hasMissing = condition.$or.some(function (c) {
            return c && c.archived && typeof c.archived === 'object' && c.archived.$exists === false;
        });
        if (hasFalse && hasMissing && Object.keys(condition).length === 1) {
            return { archived: false };
        }
    }
    var normalized = {};
    for (var key of Object.keys(condition)) {
        normalized[key] = normalizeQueryForIndex(condition[key]);
    }
    return normalized;
}

function createListCursor(userId, query, skip, limit) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');

    var ownerCondition = { ownerId: userId };
    var activeCondition = queryHasDeleted(query) ? {} : { deletedAt: { $exists: false } };
    var conditions = [ownerCondition];
    if (Object.keys(activeCondition).length) conditions.push(activeCondition);
    var normalizedQuery = normalizeQueryForIndex(query);
    if (Object.keys(normalizedQuery).length) conditions.push(normalizedQuery);
    var unifiedQuery = conditions.length === 1 ? conditions[0] : { $and: conditions };
    var hasText = queryHasText(unifiedQuery);
    var cursor = getUnifiedCollection().find(unifiedQuery);

    if (hasText) {
        cursor = cursor.project({ score: { $meta: 'textScore' } })
            .sort({ sticky: -1, score: { $meta: 'textScore' }, modifiedAt: -1, _id: -1 });
    } else {
        cursor = cursor.sort({ sticky: -1, modifiedAt: -1, _id: -1 });
    }

    if (skip) cursor = cursor.skip(skip);
    if (limit) cursor = cursor.limit(limit);
    return cursor;
}

async function getAll(userId, query, skip, limit) {
    var cursor = createListCursor(userId, query, skip, limit);
    return cursor.toArray().then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
}

async function getAllLean(userId) {
    assert.strictEqual(typeof userId, 'string');

    return getUnifiedCollection().find({ ownerId: userId, deletedAt: { $exists: false } })
        .sort({ modifiedAt: -1, _id: -1 })
        .toArray().then(function (result) {
        (result || []).forEach(postProcess.bind(null, userId));
        return result || [];
    });
}

function getSummaries(userId, query, skip, limit, includeContent) {
    var projection = { _id: 1, revision: 1, modifiedAt: 1, summary: { $substrCP: [{ $ifNull: ['$content', ''] }, 0, 300] } };
    if (includeContent) projection.content = 1;
    if (queryHasText(query)) projection.score = { $meta: 'textScore' };
    return createListCursor(userId, query, skip, limit).project(projection).maxTimeMS(3000).toArray();
}

async function getSnapshot(userId, thingId) {
    assert.strictEqual(typeof userId, 'string');
    if (!ObjectId.isValid(thingId)) throw new Error('not found');
    var result = await getUnifiedCollection().findOne({ _id: new ObjectId(thingId), ownerId: userId, deletedAt: { $exists: false } }, {
        projection: { content: 1, revision: 1 }, maxTimeMS: 3000
    });
    if (!result) throw new Error('not found');
    return result;
}

function getSnapshots(userId, thingIds) {
    assert.strictEqual(typeof userId, 'string');
    var ids = thingIds.map(function (id) { return new ObjectId(id); });
    return getUnifiedCollection().find({ _id: { $in: ids }, ownerId: userId, deletedAt: { $exists: false } })
        .project({ content: 1, revision: 1 }).maxTimeMS(3000).toArray();
}

async function getTagUsage(userId, options) {
    assert.strictEqual(typeof userId, 'string');

    var pipeline = [
        { $match: { ownerId: userId, deletedAt: { $exists: false } } },
        { $project: { tags: 1, _id: 0 } },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', usage: { $sum: 1 } } },
        { $sort: { usage: -1, _id: 1 } }
    ];
    if (options) {
        assert(Number.isInteger(options.skip) && options.skip >= 0 && options.skip <= 1000);
        assert(Number.isInteger(options.limit) && options.limit >= 1 && options.limit <= 51);
        if (options.skip) pipeline.push({ $skip: options.skip });
        pipeline.push({ $limit: options.limit });
    }
    return getUnifiedCollection().aggregate(pipeline, options ? { maxTimeMS: 3000 } : {}).toArray().then(function (result) {
        return (result || []).map(function (tag) {
            return { ownerId: userId, name: tag._id, usage: tag.usage };
        });
    });
}

async function get(userId, thingId) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');

    if (!ObjectId.isValid(thingId)) throw new Error('not found');
    var id = new ObjectId(thingId);
    var result = await getUnifiedCollection().findOne({ _id: id, ownerId: userId, deletedAt: { $exists: false } });
    if (!result) throw new Error('not found');
    postProcess(userId, result);
    return result;
}

async function getAttachmentTarget(userId, thingId) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');

    if (!ObjectId.isValid(thingId)) throw new Error('not found');
    var result = await getUnifiedCollection().findOne(
        { _id: new ObjectId(thingId), ownerId: userId, deletedAt: { $exists: false } },
        { projection: { ownerId: 1, attachments: 1, public: 1, shared: 1 } }
    );
    if (!result) throw new Error('not found');
    result._id = String(result._id);
    if (!result.ownerId) result.ownerId = userId;
    result.public = !!result.public;
    result.shared = !!result.shared;
    return result;
}

async function getDeleteTarget(userId, thingId) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) throw new Error('not found');
    var result = await getUnifiedCollection().findOne(
        { _id: new ObjectId(thingId), ownerId: userId, deletedAt: { $exists: false } },
        { projection: { revision: 1, public: 1, shared: 1 } }
    );
    if (!result) throw new Error('not found');
    return result;
}

async function getById(thingId) {
    assert.strictEqual(typeof thingId, 'string');

    if (!ObjectId.isValid(thingId)) throw new Error('not found');
    var id = new ObjectId(thingId);
    var result = await getUnifiedCollection().findOne({ _id: id });
    if (!result) throw new Error('not found');
    postProcess(result.ownerId, result);
    return result;
}

async function add(userId, content, tags, attachments, externalContent, color = 'default', assistant) {
    return insertFull(userId, content, tags, attachments, externalContent, Date.now(), Date.now(), color, assistant);
}

async function addFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color = 'default') {
    return insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color);
}

function buildThingDoc(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color = 'default', assistant) {
    if (!noteColors.isValidNoteColor(color)) {
        throw noteColors.invalidNoteColorError();
    }

    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof content, 'string');
    assert(Array.isArray(tags));
    assert(Array.isArray(attachments));
    assert(Array.isArray(externalContent));

    var doc = {
        ownerId: userId,
        content: content,
        createdAt: createdAt,
        modifiedAt: modifiedAt,
        revision: 1,
        tags: tags,
        externalContent: externalContent,
        attachments: attachments,
        public: false,
        shared: false,
        archived: false,
        sticky: false,
        color: color
    };
    if (assistant) doc.assistant = assistant;
    return doc;
}

async function insertFull(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color = 'default', assistant) {
    var doc = buildThingDoc(userId, content, tags, attachments, externalContent, createdAt, modifiedAt, color, assistant);
    var result = await getUnifiedCollection().insertOne(doc);
    if (!result) throw new Error('no result returned');
    doc._id = result.insertedId.toString();
    postProcess(userId, doc);
    return doc;
}

async function insertManyFull(userId, items, onPreparedDocs) {
    if (!items.length) return [];
    var docs = items.map(function (item) {
        var doc = buildThingDoc(
            userId,
            item.content,
            item.tags,
            item.attachments,
            item.externalContent,
            item.createdAt,
            item.modifiedAt,
            item.color
        );
        doc._id = item._id instanceof ObjectId ? item._id : new ObjectId();
        return doc;
    });
    if (typeof onPreparedDocs === 'function') onPreparedDocs(docs);
    var result = await getUnifiedCollection().insertMany(docs, { ordered: true });
    docs.forEach(function (doc, index) {
        doc._id = String((result && result.insertedIds && result.insertedIds[index]) || doc._id);
        postProcess(userId, doc);
    });
    return docs;
}

async function put(userId, thingId, content, tags, attachments, externalContent, isPublic, isShared, isArchived, isSticky, color, expectedRevision, assistant) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return Promise.reject(notFoundError());
    if (color !== undefined && !noteColors.isValidNoteColor(color)) {
        return Promise.reject(noteColors.invalidNoteColorError());
    }

    var data = {
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
    if (typeof color === 'string') {
        data.color = color;
    }
    // Assistant writes record what they changed; any other write means the owner took over.
    var update = { $set: data, $inc: { revision: 1 } };
    if (assistant) data.assistant = assistant;
    else update.$unset = { assistant: '' };

    requireRevision(expectedRevision, true);
    var id = new ObjectId(thingId);
    var collection = getUnifiedCollection();
    var result = await collection.findOneAndUpdate(
        { _id: id, ownerId: userId, revision: expectedRevision, deletedAt: { $exists: false } },
        update,
        { returnDocument: 'after', includeResultMetadata: false }
    );
    if (!result) {
        var existing = await collection.findOne({ _id: id, ownerId: userId }, { projection: { _id: 1 } });
        throw existing ? conflictError() : notFoundError();
    }
    postProcess(userId, result);
    return result;
}

async function del(userId, thingId, expectedRevision, assistant) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return Promise.reject(notFoundError());

    requireRevision(expectedRevision, false);
    var id = new ObjectId(thingId);
    var collection = getUnifiedCollection();
    var result = await collection.updateOne(
        { _id: id, ownerId: userId, revision: expectedRevision, deletedAt: { $exists: false } },
        {
            $set: Object.assign({
                deletedAt: Date.now(),
                modifiedAt: Date.now(),
                public: false,
                shared: false,
                sticky: false
            }, assistant ? { assistant: assistant } : {}),
            $inc: { revision: 1 }
        }
    );
    if (result.modifiedCount === 0) {
        var existing = await collection.findOne({ _id: id, ownerId: userId, deletedAt: { $exists: false } }, { projection: { _id: 1 } });
        throw existing ? conflictError() : notFoundError();
    }
}

async function restore(userId, thingId, expectedRevision) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return Promise.reject(notFoundError());

    requireRevision(expectedRevision, true);
    var id = new ObjectId(thingId);
    var collection = getUnifiedCollection();
    var result = await collection.findOneAndUpdate(
        { _id: id, ownerId: userId, revision: expectedRevision, deletedAt: { $exists: true } },
        {
            $unset: { deletedAt: '', assistant: '' },
            $set: { modifiedAt: Date.now(), public: false, shared: false },
            $inc: { revision: 1 }
        },
        { returnDocument: 'after', includeResultMetadata: false }
    );
    if (!result) {
        var existing = await collection.findOne({ _id: id, ownerId: userId }, { projection: { _id: 1, deletedAt: 1 } });
        throw existing ? conflictError() : notFoundError();
    }
    postProcess(userId, result);
    return result;
}

async function purge(userId, thingId, expectedRevision) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    if (!ObjectId.isValid(thingId)) return Promise.reject(notFoundError());

    requireRevision(expectedRevision, false);
    var result = await getUnifiedCollection().deleteOne({ _id: new ObjectId(thingId), ownerId: userId, revision: expectedRevision });
    if (!result.deletedCount) throw notFoundError();
}

module.exports = {
    getAll: getAll,
    getAllLean: getAllLean,
    getTagUsage: getTagUsage,
    getSummaries: getSummaries,
    getSnapshot: getSnapshot,
    getSnapshots: getSnapshots,
    get: get,
    getAttachmentTarget: getAttachmentTarget,
    getDeleteTarget: getDeleteTarget,
    getById: getById,
    add: add,
    addFull: addFull,
    insertFull: insertFull,
    insertManyFull: insertManyFull,
    put: put,
    del: del,
    restore: restore,
    purge: purge,
    ensureIndexes: ensureIndexes,
    getUnifiedCollection: getUnifiedCollection,
    resetCache: resetCache,
    queryHasText: queryHasText,
    normalizeQueryForIndex: normalizeQueryForIndex
};
