'use strict';

var things = require('../database/things.js'),
    thingService = require('./thing-service.js'),
    search = require('./search-service.js');

// Visible, owner-undoable record of an assistant write; cleared by the owner's next write.
function marker(action, client, previous) {
    var result = { action: action, client: client, at: Date.now() };
    if (previous) result.previous = previous;
    return result;
}

async function searchNotes(userId, params) {
    var rows = await things.getSummaries(userId, search.buildQuery({ filter: params.query, mode: params.mode }), params.skip, params.limit + 1, params.include_content);
    return {
        notes: rows.slice(0, params.limit).map(function (note) {
            var result = { id: note._id.toHexString(), revision: note.revision || 1, summary: note.summary, modifiedAt: note.modifiedAt };
            if (params.include_content) result.content = note.content;
            return result;
        }),
        hasMore: rows.length > params.limit
    };
}

async function getNote(userId, params) {
    var note = await things.getSnapshot(userId, params.id);
    return { id: note._id.toHexString(), content: note.content, revision: note.revision || 1 };
}

async function batchGetNotes(userId, params) {
    var rows = await things.getSnapshots(userId, params.ids);
    return rows.map(function (note) {
        return { id: note._id.toHexString(), content: note.content, revision: note.revision || 1 };
    });
}

async function listTags(userId, params) {
    var rows = await thingService.getTags(userId, { skip: params.skip, limit: params.limit + 1 });
    return { tags: rows.slice(0, params.limit).map(function (tag) { return { name: tag.name, usage: tag.usage }; }), hasMore: rows.length > params.limit };
}

async function createNote(userId, params, client) {
    var result = await thingService.add(userId, params.content, [], params.color || 'default', marker('create', client));
    return {
        id: String(result._id),
        revision: result.revision || 1
    };
}

async function updateNote(userId, params, client) {
    if (params.content === undefined && params.color === undefined && params.archived === undefined && params.sticky === undefined) {
        var argError = new Error('At least one of content, color, archived, or sticky must be provided');
        argError.code = 'invalid_arguments';
        throw argError;
    }
    var existing = await things.get(userId, params.id);
    if ((existing.revision || 1) !== params.expectedRevision) {
        var conflict = new Error('Thing revision conflict');
        conflict.code = 'revision_conflict';
        throw conflict;
    }
    if (existing.public || existing.shared) {
        var notAllowed = new Error('Public or shared notes cannot be modified via assistant');
        notAllowed.code = 'not_allowed';
        throw notAllowed;
    }
    var newContent = params.content !== undefined ? params.content : existing.content;
    var newColor = params.color !== undefined ? params.color : existing.color;
    var isArchived = params.archived !== undefined ? params.archived : !!existing.archived;
    var isSticky = params.sticky !== undefined ? params.sticky : !!existing.sticky;
    var previous = {};
    if (newContent !== existing.content) previous.content = existing.content;
    if (newColor !== existing.color) previous.color = existing.color;
    if (isArchived !== !!existing.archived) previous.archived = !!existing.archived;
    if (isSticky !== !!existing.sticky) previous.sticky = !!existing.sticky;

    var precomputed = newContent === existing.content ? {
        tags: Array.isArray(existing.tags) ? existing.tags : [],
        externalContent: Array.isArray(existing.externalContent) ? existing.externalContent : []
    } : undefined;

    var result = await thingService.put(
        userId,
        params.id,
        newContent,
        existing.attachments || [],
        false,
        false,
        isArchived,
        isSticky,
        newColor,
        params.expectedRevision,
        marker('update', client, previous),
        precomputed
    );
    return {
        id: String(result._id),
        revision: result.revision
    };
}

async function deleteNote(userId, params, client) {
    var existing = await things.getDeleteTarget(userId, params.id);
    if ((existing.revision || 1) !== params.expectedRevision) {
        var conflict = new Error('Thing revision conflict');
        conflict.code = 'revision_conflict';
        throw conflict;
    }
    if (existing.public || existing.shared) {
        var notAllowed = new Error('Public or shared notes cannot be deleted via assistant');
        notAllowed.code = 'not_allowed';
        throw notAllowed;
    }
    await thingService.del(userId, params.id, params.expectedRevision, marker('delete', client));
    return { id: params.id, deleted: true };
}

async function batchDeleteNotes(userId, params, client) {
    var items = params.items;
    var outcomes = new Array(items.length);
    var lastById = new Map();
    var cursor = 0;

    async function runOne(index) {
        var item = items[index];
        var prior = lastById.get(item.id);
        var task = (prior ? prior.catch(function () {}) : Promise.resolve()).then(async function () {
            try {
                await deleteNote(userId, item, client);
                outcomes[index] = { ok: true, id: item.id };
            } catch (error) {
                outcomes[index] = {
                    ok: false,
                    id: item.id,
                    code: error.message === 'not found' ? 'not_found' : (error.code || error.errorCode || 'tool_failed')
                };
            }
        });
        lastById.set(item.id, task);
        await task;
    }

    async function worker() {
        while (cursor < items.length) {
            var index = cursor++;
            await runOne(index);
        }
    }

    await Promise.all(Array.from({ length: Math.min(4, items.length) }, worker));

    var result = { deleted: [], errors: [] };
    for (var i = 0; i < outcomes.length; i++) {
        if (outcomes[i].ok) result.deleted.push(outcomes[i].id);
        else result.errors.push({ id: outcomes[i].id, code: outcomes[i].code });
    }
    return result;
}

module.exports = {
    searchNotes: searchNotes,
    getNote: getNote,
    batchGetNotes: batchGetNotes,
    listTags: listTags,
    createNote: createNote,
    updateNote: updateNote,
    deleteNote: deleteNote,
    batchDeleteNotes: batchDeleteNotes
};
