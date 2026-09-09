'use strict';

var assert = require('assert'),
    async = require('async'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    storage = require('../storage/local-storage.js'),
    tags = require('../database/tags.js'),
    tar = require('tar-fs'),
    thingService = require('./thing-service.js'),
    things = require('../database/things.js');

var MAX_ARCHIVE_ENTRIES = 1000;
var MAX_ARCHIVE_ENTRY_SIZE = 25 * 1024 * 1024;
var MAX_ARCHIVE_TOTAL_SIZE = 100 * 1024 * 1024;

function isSafePathSegment(segment) {
    return typeof segment === 'string' && segment && path.basename(segment) === segment && segment !== '.' && segment !== '..';
}

function validateThingsData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Archive data must be an object';
    if (!Array.isArray(data.things)) return 'Archive data must have a "things" array';

    for (var i = 0; i < data.things.length; i++) {
        var thing = data.things[i];
        if (!thing || typeof thing !== 'object' || Array.isArray(thing)) return 'Thing at index ' + i + ' must be an object';
        if (typeof thing.content !== 'string') return 'Thing at index ' + i + ' must have a string content';
        if (thing.createdAt !== undefined && typeof thing.createdAt !== 'number' && typeof thing.createdAt !== 'string') {
            return 'Thing at index ' + i + ' has invalid createdAt';
        }
        if (thing.modifiedAt !== undefined && typeof thing.modifiedAt !== 'number' && typeof thing.modifiedAt !== 'string') {
            return 'Thing at index ' + i + ' has invalid modifiedAt';
        }
        if (thing.attachments === undefined) continue;
        if (!Array.isArray(thing.attachments)) return 'Thing at index ' + i + ' attachments must be an array';

        for (var j = 0; j < thing.attachments.length; j++) {
            var attachment = thing.attachments[j];
            var identifier = typeof attachment === 'string' ? attachment : attachment && attachment.identifier;
            if (!isSafePathSegment(identifier)) return 'Thing at index ' + i + ' has invalid attachment identifier';
        }
    }
    return null;
}

function exportData(userId, callback) {
    things.getAllLean(userId, function (error, result) {
        if (error) return callback(error);
        callback(null, {
            things: (result || []).map(function (thing) {
                return {
                    createdAt: thing.createdAt,
                    modifiedAt: thing.modifiedAt,
                    content: thing.content,
                    externalContent: thing.externalContent || [],
                    attachments: thing.attachments || []
                };
            })
        });
    });
}

function createExport(userId, username, callback) {
    var attachmentFolder = storage.exportDirectory(userId, username);

    exportData(userId, function (error, result) {
        if (error && username && username !== userId) return exportData(username, createArchive);
        createArchive(error, result);
    });

    function createArchive(error, result) {
        if (error) return callback(error);
        var stream = tar.pack(attachmentFolder, {
            map: function (header) {
                header.name = 'attachments/' + header.name;
                return header;
            }
        });
        stream.entry({ name: 'things.json' }, JSON.stringify(result, null, 4));
        callback(null, stream);
    }
}

function importData(userId, data, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof data, 'object');
    assert.strictEqual(typeof callback, 'function');

    var schemaError = validateThingsData(data);
    if (schemaError) return callback(new Error(schemaError));
    var insertedThingIds = [];

    function rollback(error) {
        async.eachSeries(insertedThingIds, function (id, done) {
            things.del(userId, String(id), function () { done(); });
        }, function () {
            callback(error);
        });
    }

    async.eachSeries(data.things, function (thing, next) {
        var tagObjects = thingService.extractTags(thing.content);

        async.eachSeries(tagObjects, tags.update.bind(null, userId), function (error) {
            if (error) return next(error);

            var createdAt = thing.createdAt;
            if (typeof createdAt === 'string') createdAt = (new Date(createdAt)).getTime();
            if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();

            var modifiedAt = thing.modifiedAt;
            if (typeof modifiedAt === 'string') modifiedAt = (new Date(modifiedAt)).getTime();
            if (typeof modifiedAt !== 'number' || isNaN(modifiedAt)) modifiedAt = createdAt;

            things.addFull(userId, thing.content, tagObjects,
                Array.isArray(thing.attachments) ? thing.attachments : [],
                Array.isArray(thing.externalContent) ? thing.externalContent : [],
                createdAt, modifiedAt, function (error, result) {
                    if (error) return next(error);
                    if (!result || !result._id) return next(new Error('no result returned'));
                    insertedThingIds.push(result._id);
                    next(null);
                });
        });
    }, function (error) {
        if (error) return rollback(error);
        callback(null, insertedThingIds);
    });
}

function importArchive(userId, filePath, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof filePath, 'string');
    assert.strictEqual(typeof callback, 'function');

    var tempExtractDir;
    try {
        tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-import-'));
    } catch (error) {
        return callback(new Error('Failed to create temporary extraction directory: ' + error.message));
    }

    var finished = false;
    var copiedFiles = [];
    var entryCount = 0;
    var totalSize = 0;

    function done(error, stats) {
        if (finished) return;
        finished = true;
        try { fs.rmSync(tempExtractDir, { recursive: true, force: true }); } catch (cleanupError) {}
        if (error) {
            storage.removeFiles(copiedFiles);
            return callback(error);
        }
        callback(null, stats);
    }

    var input = fs.createReadStream(filePath);
    var extract = tar.extract(tempExtractDir, {
        map: function (header) {
            if (header.name.indexOf('attachments/') === 0) header.name = header.name.slice('attachments/'.length);
            return header;
        },
        ignore: function (name, header) {
            var error;

            if (header.type !== 'file' && header.type !== 'directory') {
                error = new Error('Dangerous or unsupported entry type in archive: ' + header.type);
            } else if (typeof header.name !== 'string' || header.name.indexOf('\0') !== -1) {
                error = new Error('Invalid archive entry name');
            } else if (header.linkname) {
                error = new Error('Archive entries with links are not allowed');
            } else if (path.isAbsolute(header.name) || header.name.startsWith('/') || header.name.startsWith('\\')) {
                error = new Error('Archive entry must not have an absolute path: ' + header.name);
            } else if (header.name.split(/[/\\]/).indexOf('..') !== -1) {
                error = new Error('Path traversal detected in archive entry: ' + header.name);
            } else {
                var relative = path.relative(tempExtractDir, name);
                if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
                    error = new Error('Archive entry path escapes extraction directory: ' + header.name);
                }
            }

            entryCount++;
            totalSize += header.size || 0;
            if (!error && entryCount > MAX_ARCHIVE_ENTRIES) error = new Error('Archive entry count limit exceeded (max: ' + MAX_ARCHIVE_ENTRIES + ')');
            if (!error && header.size > MAX_ARCHIVE_ENTRY_SIZE) error = new Error('Archive entry size limit exceeded (max: 25MB)');
            if (!error && totalSize > MAX_ARCHIVE_TOTAL_SIZE) error = new Error('Archive cumulative size limit exceeded (max: 100MB)');

            if (!error) return false;
            extract.destroy(error);
            input.destroy(error);
            return true;
        }
    });

    input.on('error', done);
    extract.on('error', done);
    extract.on('finish', function () {
        var thingsJsonPath = path.join(tempExtractDir, 'things.json');
        if (!fs.existsSync(thingsJsonPath)) return done(new Error('Archive missing things.json'));

        var data;
        try {
            data = JSON.parse(fs.readFileSync(thingsJsonPath, 'utf8'));
        } catch (error) {
            return done(new Error('things.json is not valid JSON: ' + error.message));
        }

        var schemaError = validateThingsData(data);
        if (schemaError) return done(new Error('Schema validation failed: ' + schemaError));

        var extractedFiles;
        try {
            extractedFiles = fs.readdirSync(tempExtractDir);
        } catch (error) {
            return done(new Error('Failed to read extracted files: ' + error.message));
        }

        for (var i = 0; i < extractedFiles.length; i++) {
            var file = extractedFiles[i];
            if (file === 'things.json') continue;
            var sourcePath = path.join(tempExtractDir, file);

            try {
                if (!fs.statSync(sourcePath).isFile()) continue;
                if (!isSafePathSegment(file)) return done(new Error('Unsafe attachment filename in archive: ' + file));
                var copied = storage.copyAttachment(userId, sourcePath, file);
                if (copied.created) copiedFiles.push(copied.path);
            } catch (error) {
                return done(new Error('Failed to copy attachment ' + file + ': ' + error.message));
            }
        }

        importData(userId, data, function (error, insertedIds) {
            if (error) return done(error);
            done(null, {
                total: data.things.length,
                imported: insertedIds ? insertedIds.length : data.things.length,
                failed: 0
            });
        });
    });

    input.pipe(extract);
}

function importUploadedArchive(userId, filePath, callback) {
    importArchive(userId, filePath, function (error, stats) {
        storage.removeFile(filePath);
        callback(error, stats);
    });
}

module.exports = {
    createExport: createExport,
    importUploadedArchive: importUploadedArchive,
    importArchive: importArchive,
    exportData: exportData,
    importData: importData,
    validateThingsData: validateThingsData
};
