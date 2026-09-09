'use strict';

var assert = require('assert'),
    async = require('async'),
    debug = require('debug')('services:things'),
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
    ssrf.enrichUrls(extractURLs(content), callback);
}

function facelift(userId, thing, callback) {
    var data = thing.content;
    var tagObjects = thing.tags;
    var externalContent = thing.externalContent;
    var attachments = thing.attachments || [];

    function render() {
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

        callback(null, data);
    }

    if (Array.isArray(externalContent)) return render();

    extractExternalContent(thing.content, function (error, result) {
        if (error) {
            console.error('Failed to extract external content:', error);
            externalContent = [];
            return render();
        }

        externalContent = result;
        debug('update %s with new external content.', thing._id, result);
        things.put(userId, thing._id, thing.content, thing.tags, attachments, result, false, false, false, function (error) {
            if (error) console.error('Failed to update external content:', error);
            render();
        });
    });
}

function addRichContent(userId, result, callback) {
    if (!result) return callback(null, []);

    async.each(result, function (thing, done) {
        facelift(userId, thing, function (error, data) {
            if (error) console.error('Failed to facelift:', error);
            thing.attachments = thing.attachments || [];
            thing.richContent = data || thing.content;
            done(null);
        });
    }, function () {
        callback(null, result);
    });
}

function getAll(userId, query, skip, limit, callback) {
    things.getAll(userId, query, skip, limit, function (error, result) {
        if (error) return callback(error);
        addRichContent(userId, result, callback);
    });
}

function getAllPublic(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof query, 'object');
    query.public = true;
    getAll(userId, query, skip, limit, callback);
}

function getAllLean(userId, callback) {
    things.getAllLean(userId, callback);
}

function get(userId, thingId, callback) {
    things.get(userId, thingId, function (error, result) {
        if (error) return callback(error);
        facelift(userId, result, function (error, data) {
            if (error) console.error('Failed to facelift:', error);
            result.attachments = result.attachments || [];
            result.richContent = data || result.content;
            callback(null, result);
        });
    });
}

function getPublic(userId, thingId, callback) {
    get(userId, thingId, function (error, result) {
        if (error) return callback(error);
        if (!result.public && !result.shared) return callback('not allowed');
        callback(null, result);
    });
}

function add(userId, content, attachments, callback) {
    extractExternalContent(content, function (error, externalContent) {
        if (error) return callback(error);
        var tagObjects = extractTags(content);

        async.eachSeries(tagObjects, tags.update.bind(null, userId), function (error) {
            if (error) return callback(error);
            things.add(userId, content, tagObjects, attachments, externalContent, function (error, result) {
                if (error) return callback(error);
                if (!result) return callback(new Error('no result returned'));
                get(userId, result._id, callback);
            });
        });
    });
}

function put(userId, thingId, content, attachments, isPublic, isShared, isArchived, isSticky, callback) {
    var tagObjects = extractTags(content);

    async.eachSeries(tagObjects, tags.update.bind(null, userId), function (error) {
        if (error) return callback(error);
        extractExternalContent(content, function (error, externalContent) {
            if (error) console.error('Failed to extract external content:', error);
            things.put(userId, thingId, content, tagObjects, attachments, externalContent,
                isPublic, isShared, isArchived, isSticky, function (error) {
                    if (error) return callback(error);
                    get(userId, thingId, callback);
                });
        });
    });
}

function del(userId, thingId, callback) {
    things.del(userId, thingId, callback);
}

function getTags(userId, callback) {
    tags.get(userId, callback);
}

function cleanupTags(callback) {
    async.each(things.getAllActiveUserIds(), function (userId, nextUser) {
        things.getAllLean(userId, function (error, result) {
            if (error) {
                console.error(new Error(error));
                return nextUser();
            }

            var activeTags = [];
            (result || []).forEach(function (thing) {
                activeTags = activeTags.concat(extractTags(thing.content));
            });

            tags.get(userId, function (error, result) {
                if (error) {
                    console.error(new Error(error));
                    return nextUser();
                }

                async.each(result || [], function (tag, nextTag) {
                    if (activeTags.indexOf(tag.name) !== -1) return nextTag(null);
                    debug('Cleanup tag', tag.name);
                    tags.del(userId, String(tag._id), nextTag);
                }, nextUser);
            });
        });
    }, function (error) {
        if (error) console.error('Cleanup tags failed:', error);
        if (callback) callback(error);
    });
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
