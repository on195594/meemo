'use strict';

var search = require('./search-service.js'),
    ssrf = require('../ssrf.js'),
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

function extractTags(content, urls) {
    if (!content || typeof content !== 'string' || content.indexOf('#') === -1) return [];

    urls = urls || extractURLs(content);
    if (urls.length) {
        for (var u = 0; u < urls.length; u++) {
            content = content.replace(new RegExp(escapeRegExp(urls[u]), 'gmi'), ' --URL_PLACEHOLDER-- ');
        }
    }

    var env = { tags: [] };
    tagMarkdown.render(content, env);
    return env.tags;
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

async function facelift(userId, thing) {
    return faceliftSync(userId, thing);
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

async function getAll(userId, query, skip, limit) {
    return things.getAll(userId, query, skip, limit).then(function (result) {
        return addRichContent(userId, result);
    });
}

async function getAllPublic(userId, query, skip, limit) {
    query.public = true;
    return getAll(userId, query, skip, limit);
}

async function get(userId, thingId) {
    return things.get(userId, thingId).then(function (result) {
        try {
            result.richContent = faceliftSync(userId, result);
        } catch (error) {
            console.error('Failed to facelift:', error);
            result.richContent = result.content;
        }
        result.attachments = result.attachments || [];
        return result;
    });
}

async function getPublic(userId, thingId) {
    return get(userId, thingId).then(function (result) {
        if (!result.public && !result.shared) throw 'not allowed';
        return result;
    });
}

async function getPublicShared(thingId) {
    return things.getById(thingId).then(function (doc) {
        return getPublic(doc.ownerId, thingId);
    });
}

async function add(userId, content, attachments, color = 'default', assistant) {
    var urls = extractURLs(content);
    var externalContent = await ssrf.enrichUrls(urls);
    var tagObjects = extractTags(content, urls);
    var result = await things.add(userId, content, tagObjects, attachments, externalContent, color, assistant);
    if (!result) throw new Error('no result returned');
    return addRichContent(userId, [result])[0];
}

async function put(userId, thingId, content, attachments, isPublic, isShared, isArchived, isSticky, color, expectedRevision, assistant, precomputed) {
    var tagObjects, externalContent;
    if (precomputed && Array.isArray(precomputed.tags) && Array.isArray(precomputed.externalContent)) {
        tagObjects = precomputed.tags;
        externalContent = precomputed.externalContent;
    } else {
        var urls = extractURLs(content);
        tagObjects = extractTags(content, urls);
        try {
            externalContent = await ssrf.enrichUrls(urls);
        } catch (error) {
            console.error('Failed to extract external content:', error);
            externalContent = [];
        }
    }

    // The repository still checks owner, deletion state and expectedRevision atomically.
    var updated = await things.put(userId, thingId, content, tagObjects, attachments, externalContent,
        isPublic, isShared, isArchived, isSticky, color, expectedRevision, assistant);
    return addRichContent(userId, [updated])[0];
}

async function del(userId, thingId, expectedRevision, assistant) {
    return things.del(userId, thingId, expectedRevision, assistant);
}

async function restore(userId, thingId, expectedRevision) {
    return things.restore(userId, thingId, expectedRevision).then(function (result) {
        try {
            result.richContent = faceliftSync(userId, result);
        } catch (error) {
            console.error('Failed to facelift:', error);
            result.richContent = result.content;
        }
        result.attachments = result.attachments || [];
        return result;
    });
}

async function purge(userId, thingId, expectedRevision) {
    return things.purge(userId, thingId, expectedRevision);
}

async function getTags(userId, options) {
    return things.getTagUsage(userId, options);
}

module.exports = {
    getAll: getAll,
    getAllPublic: getAllPublic,
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
    facelift: facelift,
    buildSearchFilter: search.buildSearchFilter,
    TYPE_IMAGE: TYPE_IMAGE,
    TYPE_UNKNOWN: TYPE_UNKNOWN
};
