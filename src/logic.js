/* jslint node:true */

'use strict';

exports = module.exports = {
    getAll: getAll,
    getAllPublic: getAllPublic,
    getAllLean: getAllLean,
    get: get,
    getPublic: getPublic,
    add: add,
    put: put,
    del: del,
    exp: exp,
    imp: imp,
    validateThingsData: validateThingsData,
    extractURLs: extractURLs,
    extractTags: extractTags,
    facelift: facelift,
    cleanupTags: cleanupTags,
    importThings: importThings,
    extractExternalContent: extractExternalContent,

    TYPE_IMAGE: 'image',
    TYPE_UNKNOWN: 'unknown'
};

var assert = require('assert'),
    async = require('async'),
    config = require('./config.js'),
    debug = require('debug')('logic'),
    path = require('path'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    os = require('os'),
    tags = require('./database/tags.js'),
    tar = require('tar-fs'),
    things = require('./database/things.js'),
    safe = require('safetydance'),
    ssrf = require('./ssrf.js');

var PRETTY_URL_LENGTH = 40;

var md = require('markdown-it')({
    breaks: true,
    html: true,
    linkify: true
});

function extractURLs(content) {
    var urls = [];

    // extract links, use markdown-it to avoid collecting code block links
    md.renderer.rules.link_open = function (tokens, idx) {
        // skip links which are already markdown
        if (tokens[idx].markup !== 'linkify') return '';

        var href = tokens[idx].attrs[tokens[idx].attrIndex('href')][1];

        if (href) urls.push(href);

        return '';
    };

    md.render(content);

    // remove duplicates
    return urls.filter(function (item, pos, self) {
        return self.indexOf(item) === pos;
    });
}

function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

function extractTags(content) {
    var tagObjects = [];

    // first replace all urls which might contain # with placeholders
    var urls = extractURLs(content);
    urls.forEach(function (u) {
        content = content.replace(new RegExp(escapeRegExp(u), 'gmi'), ' --URL_PLACEHOLDER-- ');
    });

    var md = require('markdown-it')()
        .use(require('markdown-it-hashtag'),{
            hashtagRegExp: '[\u00C0-\u017Fa-zA-Z0-9]+',
            preceding: ''
        });

    md.renderer.rules.hashtag_open  = function(tokens, idx) {
        var tagName = tokens[idx].content.toLowerCase();
        tagObjects.push(tagName);
        return '';
    };

    md.render(content);

    return tagObjects;
}

function extractExternalContent(content, callback) {
    var urls = extractURLs(content);
    ssrf.enrichUrls(urls, callback);
}

function facelift(userId, thing, callback) {
    var data = thing.content;
    var tagObjects = thing.tags;
    var externalContent = thing.externalContent;
    var attachments = thing.attachments || [];

    function wrapper() {

        // Enrich with tag links
        tagObjects.forEach(function (tag) {
            data = data.replace(new RegExp('#' + tag + '(#|\\s|$)', 'gmi'), '[#' + tag + '](#search?#' + tag + ')$1').trim();
        });

        // Enrich with image links
        externalContent.forEach(function (obj) {
            if (obj.type === exports.TYPE_IMAGE) {
                data = data.replace(new RegExp(escapeRegExp(obj.url), 'gmi'), '![' + obj.url + '](' + obj.url + ')');
            } else {
                var pretty = obj.url;
                try {
                    var tmp = new URL(obj.url);
                    if (tmp.protocol) {
                        pretty = obj.url.slice(tmp.protocol.length + 2);
                        if (pretty.length > PRETTY_URL_LENGTH) pretty = pretty.slice(0, PRETTY_URL_LENGTH) + '...';
                    }
                } catch (e) {
                    // Ignore URL parsing errors and keep obj.url
                }

                data = data.replace(new RegExp(escapeRegExp(obj.url), 'gmi'), '[' + pretty + '](' + obj.url + ')');
            }
        });

        // Enrich with attachments
        attachments.forEach(function (a) {
            if (a.type === exports.TYPE_IMAGE) {
                data = data.replace(new RegExp('\\[' + a.fileName + '\\]', 'gmi'), '![/api/files/' + userId + '/' + thing._id + '/' + a.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + a.identifier + ')');
            } else {
                data = data.replace(new RegExp('\\[' + a.fileName + '\\]', 'gmi'), '[' + a.identifier + '](/api/files/' + userId + '/' + thing._id + '/' + a.identifier + ')');
            }
        });

        callback(null, data);
    }

    if (Array.isArray(externalContent)) return wrapper();

    // old entry extract external content first
    extractExternalContent(thing.content, function (error, result) {
        if (error) {
            console.error('Failed to extract external content:', error);

            externalContent = [];

            return wrapper();
        }

        // set for wrapper()
        externalContent = result;

        debug('update %s with new external content.', thing._id, result);

        things.put(userId, thing._id, thing.content, thing.tags, attachments, result, false, false, false, function (error) {
            if (error) console.error('Failed to update external content:', error);

            wrapper();
        });
    });
}

function getAll(userId, query, skip, limit, callback) {
    things.getAll(userId, query, skip, limit, function (error, result) {
        if (error) return callback(error);
        if (!result) return callback(null, []);

        async.each(result, function (thing, callback) {
            facelift(userId, thing, function (error, data) {
                if (error) console.error('Failed to facelift:', error);

                thing.attachments = thing.attachments || [];
                thing.richContent = data || thing.content;

                callback(null);
            });
        }, function () {
            callback(null, result);
        });
    });
}

function getAllLean(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    things.getAllLean(userId, callback);
}

function get(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof callback, 'function');

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

function getAllPublic(userId, query, skip, limit, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof query, 'object');
    assert.strictEqual(typeof skip, 'number');
    assert.strictEqual(typeof limit, 'number');
    assert.strictEqual(typeof callback, 'function');

    query.public = true;

    things.getAll(userId, query, skip, limit, function (error, result) {
        if (error) return callback(error);
        if (!result) return callback(null, []);

        async.each(result, function (thing, callback) {
            facelift(userId, thing, function (error, data) {
                if (error) console.error('Failed to facelift:', error);

                thing.attachments = thing.attachments || [];
                thing.richContent = data || thing.content;

                callback(null);
            });
        }, function () {
            callback(null, result);
        });
    });
}

function getPublic(userId, thingId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof callback, 'function');

    get(userId, thingId, function (error, result) {
        if (error) return callback(error);

        if (!result.public && !result.shared) return callback('not allowed');

        callback(null, result);
    });
}

function add(userId, content, attachments, callback) {
    extractExternalContent(content, function (error, result) {
        if (error) return callback(error);

        var doc = {
            content: content,
            createdAt: Date.now(),
            modifiedAt: Date.now(),
            tags: extractTags(content),
            externalContent: result,
            attachments: attachments
        };

        async.eachSeries(doc.tags, tags.update.bind(null, userId), function (error) {
            if (error) return callback(error);

            things.add(userId, doc.content, doc.tags, doc.attachments, doc.externalContent, function (error, result) {
                if (error) return callback(error);
                if (!result) return callback(new Error('no result returned'));

                get(userId, result._id, callback);
            });
        });
    });
}

function put(userId, thingId, content, attachments, isPublic, isShared, isArchived, isSticky, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof thingId, 'string');
    assert.strictEqual(typeof content, 'string');
    assert(Array.isArray(attachments));
    assert.strictEqual(typeof isPublic, 'boolean');
    assert.strictEqual(typeof isShared, 'boolean');
    assert.strictEqual(typeof isArchived, 'boolean');
    assert.strictEqual(typeof isSticky, 'boolean');
    assert.strictEqual(typeof callback, 'function');

    var tagObjects = extractTags(content);

    async.eachSeries(tagObjects, tags.update.bind(null, userId), function (error) {
        if (error) return callback(error);

        extractExternalContent(content, function (error, externalContent) {
            if (error) console.error('Failed to extract external content:', error);

            things.put(userId, thingId, content, tagObjects, attachments, externalContent, isPublic, isShared, isArchived, isSticky, function (error) {
                if (error) return callback(error);

                get(userId, thingId, callback);
            });
        });
    });
}

function del(userId, id, callback) {
    things.del(userId, id, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}

function isSafePathSegment(segment) {
    if (typeof segment !== 'string' || !segment) return false;
    if (path.basename(segment) !== segment) return false;
    if (segment === '.' || segment === '..') return false;
    return true;
}

function validateThingsData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return 'Archive data must be an object';
    }
    if (!Array.isArray(data.things)) {
        return 'Archive data must have a "things" array';
    }
    for (var i = 0; i < data.things.length; i++) {
        var thing = data.things[i];
        if (!thing || typeof thing !== 'object' || Array.isArray(thing)) {
            return 'Thing at index ' + i + ' must be an object';
        }
        if (typeof thing.content !== 'string') {
            return 'Thing at index ' + i + ' must have a string content';
        }
        if (thing.createdAt !== undefined && typeof thing.createdAt !== 'number' && typeof thing.createdAt !== 'string') {
            return 'Thing at index ' + i + ' has invalid createdAt';
        }
        if (thing.modifiedAt !== undefined && typeof thing.modifiedAt !== 'number' && typeof thing.modifiedAt !== 'string') {
            return 'Thing at index ' + i + ' has invalid modifiedAt';
        }
        if (thing.attachments !== undefined) {
            if (!Array.isArray(thing.attachments)) {
                return 'Thing at index ' + i + ' attachments must be an array';
            }
            for (var j = 0; j < thing.attachments.length; j++) {
                var att = thing.attachments[j];
                if (typeof att === 'string') {
                    if (!isSafePathSegment(att)) {
                        return 'Thing at index ' + i + ' has invalid attachment identifier';
                    }
                } else if (att && typeof att === 'object') {
                    if (typeof att.identifier !== 'string' || !isSafePathSegment(att.identifier)) {
                        return 'Thing at index ' + i + ' has invalid attachment identifier';
                    }
                } else {
                    return 'Thing at index ' + i + ' has invalid attachment entry';
                }
            }
        }
    }
    return null;
}

var MAX_ARCHIVE_ENTRIES = 1000;
var MAX_ARCHIVE_ENTRY_SIZE = 25 * 1024 * 1024; // 25 MB
var MAX_ARCHIVE_TOTAL_SIZE = 100 * 1024 * 1024; // 100 MB

function exp(userId, callback) {
    things.getAllLean(userId, function (error, result) {
        if (error) return callback(error);
        if (!result) return callback(null, { things: [] });

        var out = result.map(function (thing) {
            return {
                createdAt: thing.createdAt,
                modifiedAt: thing.modifiedAt,
                content: thing.content,
                externalContent: thing.externalContent || [],
                attachments: thing.attachments || []
            };
        });

        callback(null, { things: out });
    });
}

function imp(userId, data, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof data, 'object');
    assert.strictEqual(typeof callback, 'function');

    var schemaError = validateThingsData(data);
    if (schemaError) return callback(new Error(schemaError));

    var insertedThingIds = [];

    function rollback(err) {
        async.eachSeries(insertedThingIds, function (id, done) {
            things.del(userId, String(id), function () {
                done();
            });
        }, function () {
            callback(err);
        });
    }

    async.eachSeries(data.things, function (thing, next) {
        var tagObjects = extractTags(thing.content);

        async.eachSeries(tagObjects, tags.update.bind(null, userId), function (error) {
            if (error) return next(error);

            // older exports use strings here
            var createdAt = thing.createdAt;
            if (typeof createdAt === 'string') createdAt = (new Date(createdAt)).getTime();
            if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();

            var modifiedAt = thing.modifiedAt;
            if (typeof modifiedAt === 'string') modifiedAt = (new Date(modifiedAt)).getTime();
            if (typeof modifiedAt !== 'number' || isNaN(modifiedAt)) modifiedAt = createdAt;

            var attachments = Array.isArray(thing.attachments) ? thing.attachments : [];
            var externalContent = Array.isArray(thing.externalContent) ? thing.externalContent : [];

            things.addFull(userId, thing.content, tagObjects, attachments, externalContent, createdAt, modifiedAt, function (error, result) {
                if (error) return next(error);
                if (!result || !result._id) return next(new Error('no result returned'));

                insertedThingIds.push(result._id);
                next(null);
            });
        });
    }, function (error) {
        if (error) {
            return rollback(error);
        }
        callback(null, insertedThingIds);
    });
}

function cleanupTags(callback) {
    var userIds = things.getAllActiveUserIds();

    async.each(userIds, function (userId, nextUser) {
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

function importThings(userId, filePath, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof filePath, 'string');
    assert.strictEqual(typeof callback, 'function');

    var attachmentFolder = path.join(config.attachmentDir, userId);
    var tempExtractDir;

    try {
        tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-import-'));
    } catch (e) {
        return callback(new Error('Failed to create temporary extraction directory: ' + e.message));
    }

    var finished = false;
    var copiedFiles = [];

    function cleanupExtractDir() {
        if (tempExtractDir && fs.existsSync(tempExtractDir)) {
            try {
                fs.rmSync(tempExtractDir, { recursive: true, force: true });
            } catch (e) {}
        }
    }

    function rollbackFiles() {
        copiedFiles.forEach(function (f) {
            try {
                if (fs.existsSync(f)) fs.unlinkSync(f);
            } catch (e) {}
        });
        copiedFiles = [];
    }

    function done(err, stats) {
        if (finished) return;
        finished = true;

        cleanupExtractDir();

        if (err) {
            rollbackFiles();
            return callback(err);
        }

        callback(null, stats);
    }

    var entryCount = 0;
    var totalSize = 0;

    var outStream = fs.createReadStream(filePath);
    var extract = tar.extract(tempExtractDir, {
        map: function (header) {
            var prefix = 'attachments/';
            if (header.name.indexOf(prefix) === 0) {
                header.name = header.name.slice(prefix.length);
            }
            return header;
        },
        ignore: function (name, header) {
            // Check for unsupported / dangerous entry types
            if (header.type !== 'file' && header.type !== 'directory') {
                var typeErr = new Error('Dangerous or unsupported entry type in archive: ' + header.type);
                extract.destroy(typeErr);
                outStream.destroy(typeErr);
                return true;
            }

            // Path traversal and dangerous character check
            if (typeof header.name !== 'string' || header.name.indexOf('\0') !== -1) {
                var nameErr = new Error('Invalid archive entry name');
                extract.destroy(nameErr);
                outStream.destroy(nameErr);
                return true;
            }

            if (header.linkname) {
                var linkErr = new Error('Archive entries with links are not allowed');
                extract.destroy(linkErr);
                outStream.destroy(linkErr);
                return true;
            }

            if (path.isAbsolute(header.name) || header.name.startsWith('/') || header.name.startsWith('\\')) {
                var absErr = new Error('Archive entry must not have an absolute path: ' + header.name);
                extract.destroy(absErr);
                outStream.destroy(absErr);
                return true;
            }

            var parts = header.name.split(/[/\\]/);
            if (parts.indexOf('..') !== -1) {
                var travErr = new Error('Path traversal detected in archive entry: ' + header.name);
                extract.destroy(travErr);
                outStream.destroy(travErr);
                return true;
            }

            var rel = path.relative(tempExtractDir, name);
            if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
                var escErr = new Error('Archive entry path escapes extraction directory: ' + header.name);
                extract.destroy(escErr);
                outStream.destroy(escErr);
                return true;
            }

            // Entry count limit
            entryCount++;
            if (entryCount > MAX_ARCHIVE_ENTRIES) {
                var countErr = new Error('Archive entry count limit exceeded (max: ' + MAX_ARCHIVE_ENTRIES + ')');
                extract.destroy(countErr);
                outStream.destroy(countErr);
                return true;
            }

            // Single entry size limit
            if (header.size && header.size > MAX_ARCHIVE_ENTRY_SIZE) {
                var sizeErr = new Error('Archive entry size limit exceeded (max: 25MB)');
                extract.destroy(sizeErr);
                outStream.destroy(sizeErr);
                return true;
            }

            // Cumulative uncompressed size limit
            totalSize += (header.size || 0);
            if (totalSize > MAX_ARCHIVE_TOTAL_SIZE) {
                var totalErr = new Error('Archive cumulative size limit exceeded (max: 100MB)');
                extract.destroy(totalErr);
                outStream.destroy(totalErr);
                return true;
            }

            return false;
        }
    });

    outStream.on('error', function (err) {
        done(err);
    });

    extract.on('error', function (err) {
        done(err);
    });

    extract.on('finish', function () {
        var thingsJsonPath = path.join(tempExtractDir, 'things.json');
        if (!fs.existsSync(thingsJsonPath)) {
            return done(new Error('Archive missing things.json'));
        }

        var data;
        try {
            var rawContent = fs.readFileSync(thingsJsonPath, 'utf8');
            data = JSON.parse(rawContent);
        } catch (e) {
            return done(new Error('things.json is not valid JSON: ' + e.message));
        }

        var schemaError = validateThingsData(data);
        if (schemaError) {
            return done(new Error('Schema validation failed: ' + schemaError));
        }

        // Copy extracted attachments to user attachment folder
        mkdirp.sync(attachmentFolder);

        var extractedFiles;
        try {
            extractedFiles = fs.readdirSync(tempExtractDir);
        } catch (e) {
            return done(new Error('Failed to read extracted files: ' + e.message));
        }

        for (var i = 0; i < extractedFiles.length; i++) {
            var file = extractedFiles[i];
            if (file === 'things.json') continue;

            var srcPath = path.join(tempExtractDir, file);
            var stat;
            try {
                stat = fs.statSync(srcPath);
            } catch (e) {
                return done(e);
            }

            if (!stat.isFile()) continue;

            if (!isSafePathSegment(file)) {
                return done(new Error('Unsafe attachment filename in archive: ' + file));
            }

            var destPath = path.join(attachmentFolder, file);
            try {
                var existedBefore = fs.existsSync(destPath);
                fs.copyFileSync(srcPath, destPath);
                if (!existedBefore) {
                    copiedFiles.push(destPath);
                }
            } catch (e) {
                return done(new Error('Failed to copy attachment ' + file + ': ' + e.message));
            }
        }

        // Atomically insert into database
        imp(userId, data, function (err, insertedIds) {
            if (err) {
                return done(err);
            }

            var stats = {
                total: data.things.length,
                imported: insertedIds ? insertedIds.length : data.things.length,
                failed: 0
            };

            done(null, stats);
        });
    });

    outStream.pipe(extract);
}
