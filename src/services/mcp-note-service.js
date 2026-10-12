'use strict';

var things = require('../database/things.js'),
    thingService = require('./thing-service.js'),
    search = require('./search-service.js');

async function searchNotes(userId, params) {
    var rows = await things.getSummaries(userId, search.buildQuery({ filter: params.query, mode: params.mode }), params.skip, params.limit + 1);
    return {
        notes: rows.slice(0, params.limit).map(function (note) {
            return { id: note._id.toHexString(), revision: note.revision || 1, summary: note.content, modifiedAt: note.modifiedAt };
        }),
        hasMore: rows.length > params.limit
    };
}

async function getNote(userId, params) {
    var note = await things.getSnapshot(userId, params.id);
    return { id: note._id.toHexString(), content: note.content, revision: note.revision || 1 };
}

async function listTags(userId, params) {
    var rows = await thingService.getTags(userId, { skip: params.skip, limit: params.limit + 1 });
    return { tags: rows.slice(0, params.limit).map(function (tag) { return { name: tag.name, usage: tag.usage }; }), hasMore: rows.length > params.limit };
}

module.exports = { searchNotes: searchNotes, getNote: getNote, listTags: listTags };
