'use strict';

var debug = require('debug')('services:things'),
    nodeify = require('../promise.js'),
    search = require('./search-service.js'),
    ssrf = require('../ssrf.js'),
    tags = require('../database/tags.js'),
    things = require('../database/things.js');

var TYPE_IMAGE = 'image';
var TYPE_UNKNOWN = 'unknown';
var PRETTY_URL_LENGTH = 40;
var markdown = require('markdown-it')({ breaks: true, html: true, linkify: true });
markdown.renderer.rules.link_open = function (tokens, idx, options, env) {
    if (tokens[idx].markup !== 'linkify') return '';
    var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];
    if (href && env && env.urls) env.urls.push(href);
    return '';
};

var tagMarkdown = require('markdown-it')().use(require('markdown-it-hashtag'), {
    hashtagRegExp: '[\\u00C0-\\u017Fa-zA-Z0-9\\u4e00-\\u9fa5\\u3040-\\u309f\\u30a0-\\u30ff\\uac00-\\ud7af_]+',
    preceding: ''
});
tagMarkdown.renderer.rules.hashtag_open = function (tokens, idx, options, env) {
    if (env && env.tags) env.tags.push(tokens[idx].content.toLowerCase());
    return '';
};

var escapeRegExp = search.escapeRegExp;
var URL_FEATURE_PATTERN = /([a-z][a-z0-9+.-]*:\/\/|mailto:)/i;

function extractURLs(content) {
    if (!content || typeof content !== 'string') return [];
    if (!URL_FEATURE_PATTERN.test(content)) {
        return [];
    }
    var env = { urls: [] };
    markdown.render(content, env);
    return Array.from(new Set(env.urls));
}

function extractTags(content) {
    if (!content || typeof content !== 'string' || content.indexOf('#') === -1) return [];

    var urls = extractURLs(content);
    if (urls.length) {
        for (var u = 0; u < urls.length; u++) {
            content = content.replace(new RegExp(escapeRegExp(urls[u]), 'gmi'), ' --URL_PLACEHOLDER-- ');
        }
    }

    var env = { tags: [] };
    tagMarkdown.render(content, env);
    return env.tags;
}

function extractExternalContent(content, callback) {
    return nodeify(ssrf.enrichUrls(extractURLs(content)), callback);
}

function faceliftSync(userId, thing) {
    if (!thing || !thing.content) return '';
    var data = thing.content;
    var tagObjects = thing.tags || [];
    var externalContent = Array.isArray(thing.externalContent) ? thing.externalContent : [];
    var attachments = thing.attachments || [];
    thing.externalContent = externalContent;

    // Fast path: notes without tags, links, attachments, or placeholders require no string replacement
    if (!tagObjects.length && !externalContent.length && !attachments.length &&
        data.indexOf('[[') === -1 && data.indexOf('#') === -1) {
        return data;
    }

    var wikilinks = [];
    if (data.indexOf('[[') !== -1) {
        data = data.replace(/\[\[[^\]\n]+\]\]/g, function (match) {
            wikilinks.push(match);
            return '@@WIKILINK_PLACEHOLDER_' + (wikilinks.length - 1) + '@@';
        });
    }

    for (var i = 0; i < tagObjects.length; i++) {
        var tag = tagObjects[i];
        data = data.replace(new RegExp('#' + escapeRegExp(tag) + '(#|\\s|$)', 'gmi'), '[#' + tag + '](#search?#' + tag + ')$1').trim();
    }

    for (var j = 0; j < externalContent.length; j++) {
        var item = externalContent[j];
        if (item.type === TYPE_IMAGE) {
            data = data.replace(new RegExp(escapeRegExp(item.url), 'gmi'), '![' + item.url + '](' + item.url + ')');
            continue;
        }

        var pretty = item.url;
        try {
            var parsed = new URL(item.url);
            if (parsed.protocol) {
                pretty = item.url.slice(parsed.protocol.length + 2);
                if (pretty.length > PRETTY_URL_LENGTH) pretty = pretty.slice(0, PRETTY_URL_LENGTH) + '...';
            }
        } catch (error) {}
        data = data.replace(new RegExp(escapeRegExp(item.url), 'gmi'), '[' + pretty + '](' + item.url + ')');
    }

    for (var k = 0; k < attachments.length; k++) {
        var attachment = attachments[k];
        if (!attachment || !attachment.fileName) continue;
        var escapedName = escapeRegExp(attachment.fileName);
        if (attachment.type === TYPE_IMAGE) {
            data = data.replace(new RegExp('\\[' + escapedName + '\\]', 'gmi'), '![/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + ')');
        } else {
            data = data.replace(new RegExp('\\[' + escapedName + '\\]', 'gmi'), '[' + attachment.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + ')');
        }
    }

    if (wikilinks.length) {
        data = data.replace(/@@WIKILINK_PLACEHOLDER_(\d+)@@/g, function (match, index) {
            return wikilinks[Number(index)] || match;
        });
    }
    return data;
}

function facelift(userId, thing, callback) {
    var promise = Promise.resolve().then(function () {
        return faceliftSync(userId, thing);
    });
    return nodeify(promise, callback);
}

function addRichContent(userId, result) {
    if (!result) return [];
    for (var i = 0; i < result.length; i++) {
        var thing = result[i];
        try {
            thing.richContent = faceliftSync(userId, thing);
        } catch (error) {
            console.error('Failed to facelift:', error);
            thing.richContent = thing.content;
        }
        thing.attachments = thing.attachments || [];
    }
    return result;
}

function getAll(userId, query, skip, limit, callback) {
    var promise = things.getAll(userId, query, skip, limit).then(function (result) {
        return addRichContent(userId, result);
    });
    return nodeify(promise, callback);
}

function getAllPublic(userId, query, skip, limit, callback) {
    query.public = true;
    return getAll(userId, query, skip, limit, callback);
}

function getAllLean(userId, callback) {
    return nodeify(things.getAllLean(userId), callback);
}

function get(userId, thingId, callback) {
    var promise = things.get(userId, thingId).then(function (result) {
        try {
            result.richContent = faceliftSync(userId, result);
        } catch (error) {
            console.error('Failed to facelift:', error);
            result.richContent = result.content;
        }
        result.attachments = result.attachments || [];
        return result;
    });
    return nodeify(promise, callback);
}

function getPublic(userId, thingId, callback) {
    var promise = get(userId, thingId).then(function (result) {
        if (!result.public && !result.shared) throw 'not allowed';
        return result;
    });
    return nodeify(promise, callback);
}

function getPublicShared(thingId, callback) {
    var promise = things.getById(thingId).then(function (doc) {
        return getPublic(doc.ownerId, thingId);
    });
    return nodeify(promise, callback);
}

function add(userId, content, attachments, color, callback) {
    if (typeof color === 'function') {
        callback = color;
        color = 'default';
    }
    var promise = Promise.resolve().then(async function () {
        var externalContent = await extractExternalContent(content);
        var tagObjects = extractTags(content);
        var result = await things.add(userId, content, tagObjects, attachments, externalContent, color);
        if (!result) throw new Error('no result returned');
        return get(userId, result._id);
    });
    return nodeify(promise, callback);
}

function put(userId, thingId, content, attachments, isPublic, isShared, isArchived, isSticky, color, expectedRevision, callback) {
    if (typeof expectedRevision === 'function') {
        callback = expectedRevision;
        expectedRevision = undefined;
    }
    if (typeof color === 'function') {
        callback = color;
        color = undefined;
        expectedRevision = undefined;
    }
    var promise = Promise.resolve().then(async function () {
        var tagObjects = extractTags(content);
        var externalContent;
        try {
            externalContent = await extractExternalContent(content);
        } catch (error) {
            console.error('Failed to extract external content:', error);
            externalContent = [];
        }

        return things.put(userId, thingId, content, tagObjects, attachments, externalContent,
            isPublic, isShared, isArchived, isSticky, color, expectedRevision);
    });
    return nodeify(promise, callback);
}

function del(userId, thingId, expectedRevision, callback) {
    if (typeof expectedRevision === 'function') {
        callback = expectedRevision;
        expectedRevision = undefined;
    }
    return nodeify(things.del(userId, thingId, expectedRevision), callback);
}

function restore(userId, thingId, expectedRevision, callback) {
    if (typeof expectedRevision === 'function') {
        callback = expectedRevision;
        expectedRevision = undefined;
    }
    var promise = things.restore(userId, thingId, expectedRevision).then(function (result) {
        try {
            result.richContent = faceliftSync(userId, result);
        } catch (error) {
            console.error('Failed to facelift:', error);
            result.richContent = result.content;
        }
        result.attachments = result.attachments || [];
        return result;
    });
    return nodeify(promise, callback);
}

function purge(userId, thingId, expectedRevision, callback) {
    if (typeof expectedRevision === 'function') {
        callback = expectedRevision;
        expectedRevision = undefined;
    }
    return nodeify(things.purge(userId, thingId, expectedRevision), callback);
}

function getTags(userId, callback) {
    return nodeify(things.getTagUsage(userId), callback);
}

function cleanupTags(callback) {
    var promise = Promise.resolve().then(async function () {
        var repairedAt = Date.now();
        var saved = await tags.getUnifiedCollection().find({}).toArray();
        var metadata = new Map();
        saved.forEach(function (tag) {
            metadata.set(JSON.stringify([tag.ownerId, tag.name]), tag);
        });

        var thingsCol = things.getUnifiedCollection();
        var allThings = await thingsCol.find({ deletedAt: { $exists: false } }).toArray();
        for (var thing of allThings) {
            if (typeof thing.ownerId !== 'string' || typeof thing.content !== 'string') {
                throw new Error('Thing owner or content prevents exact tag reconstruction');
            }
            var extracted = extractTags(thing.content);
            if (JSON.stringify(thing.tags) !== JSON.stringify(extracted)) {
                // CAS: update only if content has not changed concurrently
                await thingsCol.updateOne(
                    { _id: thing._id, ownerId: thing.ownerId, content: thing.content, revision: thing.revision },
                    { $set: { tags: extracted }, $inc: { revision: 1 } }
                );
            }
        }

        var aggregated = await thingsCol.aggregate([
            { $match: { deletedAt: { $exists: false } } },
            { $unwind: '$tags' },
            { $group: { _id: { ownerId: '$ownerId', name: '$tags' }, usage: { $sum: 1 } } },
            { $sort: { '_id.ownerId': 1, '_id.name': 1 } }
        ]).toArray();

        var reconstructed = aggregated.map(function (item) {
            var identity = JSON.stringify([item._id.ownerId, item._id.name]);
            var existing = metadata.get(identity);
            var record = {
                ownerId: item._id.ownerId,
                name: item._id.name,
                usage: item.usage,
                createdAt: existing && existing.createdAt || repairedAt,
                modifiedAt: repairedAt
            };
            if (existing && existing.usage === record.usage && existing.modifiedAt != null) {
                record.modifiedAt = existing.modifiedAt;
            }
            return record;
        });
        debug('Reconstruct all tags projection atomically via rename');
        await tags.replaceAll(reconstructed);
    });
    return nodeify(promise, callback);
}

module.exports = {
    getAll: getAll,
    getAllPublic: getAllPublic,
    getAllLean: getAllLean,
    get: get,
    getPublic: getPublic,
    getPublicShared: getPublicShared,
    add: add,
    put: put,
    del: del,
    restore: restore,
    purge: purge,
    getTags: getTags,
    extractURLs: extractURLs,
    extractTags: extractTags,
    extractExternalContent: extractExternalContent,
    facelift: facelift,
    cleanupTags: cleanupTags,
    buildSearchFilter: search.buildSearchFilter,
    escapeRegExp: escapeRegExp,
    TYPE_IMAGE: TYPE_IMAGE,
    TYPE_UNKNOWN: TYPE_UNKNOWN
};
