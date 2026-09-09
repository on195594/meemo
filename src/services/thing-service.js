'use strict';

var debug = require('debug')('services:things'),
    nodeify = require('../promise.js'),
    ssrf = require('../ssrf.js'),
    tags = require('../database/tags.js'),
    things = require('../database/things.js');

var TYPE_IMAGE = 'image';
var TYPE_UNKNOWN = 'unknown';
var PRETTY_URL_LENGTH = 40;
var markdown = require('markdown-it')({ breaks: true, html: true, linkify: true });

function extractURLs(content) {
    var urls = [];
    markdown.renderer.rules.link_open = function (tokens, idx) {
        if (tokens[idx].markup !== 'linkify') return '';
        var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];
        if (href) urls.push(href);
        return '';
    };
    markdown.render(content);
    return urls.filter(function (item, pos, self) { return self.indexOf(item) === pos; });
}

function escapeRegExp(value) {
    return value.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, '\\$&');
}

function extractTags(content) {
    var tagObjects = [];
    extractURLs(content).forEach(function (url) {
        content = content.replace(new RegExp(escapeRegExp(url), 'gmi'), ' --URL_PLACEHOLDER-- ');
    });

    var tagMarkdown = require('markdown-it')().use(require('markdown-it-hashtag'), {
        hashtagRegExp: '[\u00C0-\u017Fa-zA-Z0-9]+',
        preceding: ''
    });
    tagMarkdown.renderer.rules.hashtag_open = function (tokens, idx) {
        tagObjects.push(tokens[idx].content.toLowerCase());
        return '';
    };
    tagMarkdown.render(content);
    return tagObjects;
}

function extractExternalContent(content, callback) {
    return nodeify(ssrf.enrichUrls(extractURLs(content)), callback);
}

function facelift(userId, thing, callback) {
    var promise = Promise.resolve().then(async function () {
        var data = thing.content;
        var tagObjects = thing.tags;
        var externalContent = thing.externalContent;
        var attachments = thing.attachments || [];

        if (!Array.isArray(externalContent)) {
            try {
                externalContent = await extractExternalContent(thing.content);
                debug('update %s with new external content.', thing._id, externalContent);
                try {
                    await things.put(userId, thing._id, thing.content, thing.tags, attachments, externalContent, false, false, false, false);
                } catch (updateError) {
                    console.error('Failed to update external content:', updateError);
                }
            } catch (error) {
                console.error('Failed to extract external content:', error);
                externalContent = [];
            }
        }

        tagObjects.forEach(function (tag) {
            data = data.replace(new RegExp('#' + tag + '(#|\\s|$)', 'gmi'), '[#' + tag + '](#search?#' + tag + ')$1').trim();
        });
        externalContent.forEach(function (item) {
            if (item.type === TYPE_IMAGE) {
                data = data.replace(new RegExp(escapeRegExp(item.url), 'gmi'), '![' + item.url + '](' + item.url + ')');
                return;
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
        });
        attachments.forEach(function (attachment) {
            if (attachment.type === TYPE_IMAGE) {
                data = data.replace(new RegExp('\\[' + attachment.fileName + '\\]', 'gmi'), '![/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + ')');
            } else {
                data = data.replace(new RegExp('\\[' + attachment.fileName + '\\]', 'gmi'), '[' + attachment.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + attachment.identifier + ')');
            }
        });
        return data;
    });
    return nodeify(promise, callback);
}

async function addRichContent(userId, result) {
    await Promise.all((result || []).map(async function (thing) {
        try {
            thing.richContent = await facelift(userId, thing);
        } catch (error) {
            console.error('Failed to facelift:', error);
            thing.richContent = thing.content;
        }
        thing.attachments = thing.attachments || [];
    }));
    return result || [];
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
    var promise = things.get(userId, thingId).then(async function (result) {
        try {
            result.richContent = await facelift(userId, result);
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

function add(userId, content, attachments, callback) {
    var promise = Promise.resolve().then(async function () {
        var externalContent = await extractExternalContent(content);
        var tagObjects = extractTags(content);
        for (var tag of tagObjects) await tags.update(userId, tag);
        var result = await things.add(userId, content, tagObjects, attachments, externalContent);
        if (!result) throw new Error('no result returned');
        return get(userId, result._id);
    });
    return nodeify(promise, callback);
}

function put(userId, thingId, content, attachments, isPublic, isShared, isArchived, isSticky, callback) {
    var promise = Promise.resolve().then(async function () {
        var tagObjects = extractTags(content);
        for (var tag of tagObjects) await tags.update(userId, tag);

        var externalContent;
        try {
            externalContent = await extractExternalContent(content);
        } catch (error) {
            console.error('Failed to extract external content:', error);
            externalContent = [];
        }

        await things.put(userId, thingId, content, tagObjects, attachments, externalContent,
            isPublic, isShared, isArchived, isSticky);
        return get(userId, thingId);
    });
    return nodeify(promise, callback);
}

function del(userId, thingId, callback) {
    return nodeify(things.del(userId, thingId), callback);
}

function getTags(userId, callback) {
    return nodeify(tags.get(userId), callback);
}

function cleanupTags(callback) {
    var promise = Promise.resolve().then(async function () {
        for (var userId of things.getAllActiveUserIds()) {
            try {
                var result = await things.getAllLean(userId);
                var activeTags = [];
                (result || []).forEach(function (thing) {
                    activeTags = activeTags.concat(extractTags(thing.content));
                });

                var savedTags = await tags.get(userId);
                for (var tag of savedTags || []) {
                    if (activeTags.indexOf(tag.name) === -1) {
                        debug('Cleanup tag', tag.name);
                        await tags.del(userId, String(tag._id));
                    }
                }
            } catch (error) {
                console.error('Cleanup tags failed for user:', error);
            }
        }
    });
    return nodeify(promise, callback);
}

module.exports = {
    getAll: getAll,
    getAllPublic: getAllPublic,
    getAllLean: getAllLean,
    get: get,
    getPublic: getPublic,
    add: add,
    put: put,
    del: del,
    getTags: getTags,
    extractURLs: extractURLs,
    extractTags: extractTags,
    extractExternalContent: extractExternalContent,
    facelift: facelift,
    cleanupTags: cleanupTags,
    TYPE_IMAGE: TYPE_IMAGE,
    TYPE_UNKNOWN: TYPE_UNKNOWN
};
