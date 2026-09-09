'use strict';

var assert = require('assert'),
    fs = require('fs'),
    files = fs.promises,
    os = require('os'),
    path = require('path'),
    nodeify = require('../promise.js'),
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
    var promise = things.getAllLean(userId).then(function (result) {
        return {
            things: (result || []).map(function (thing) {
                return {
                    createdAt: thing.createdAt,
                    modifiedAt: thing.modifiedAt,
                    content: thing.content,
                    externalContent: thing.externalContent || [],
                    attachments: thing.attachments || []
                };
            })
        };
    });
    return nodeify(promise, callback);
}

function createExport(userId, username, callback) {
    var promise = Promise.resolve().then(async function () {
        var attachmentFolder = await storage.exportDirectory(userId, username);
        var result;
        try {
            result = await exportData(userId);
        } catch (error) {
            if (!username || username === userId) throw error;
            result = await exportData(username);
        }

        var stream = tar.pack(attachmentFolder, {
            map: function (header) {
                header.name = 'attachments/' + header.name;
                return header;
            }
        });
        stream.entry({ name: 'things.json' }, JSON.stringify(result, null, 4));
        return stream;
    });
    return nodeify(promise, callback);
}

function importData(userId, data, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof data, 'object');

    var promise = Promise.resolve().then(async function () {
        var schemaError = validateThingsData(data);
        if (schemaError) throw new Error(schemaError);
        var insertedThingIds = [];

        try {
            for (var thing of data.things) {
                var tagObjects = thingService.extractTags(thing.content);
                for (var tag of tagObjects) await tags.update(userId, tag);

                var createdAt = thing.createdAt;
                if (typeof createdAt === 'string') createdAt = (new Date(createdAt)).getTime();
                if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();

                var modifiedAt = thing.modifiedAt;
                if (typeof modifiedAt === 'string') modifiedAt = (new Date(modifiedAt)).getTime();
                if (typeof modifiedAt !== 'number' || isNaN(modifiedAt)) modifiedAt = createdAt;

                var result = await things.addFull(userId, thing.content, tagObjects,
                    Array.isArray(thing.attachments) ? thing.attachments : [],
                    Array.isArray(thing.externalContent) ? thing.externalContent : [], createdAt, modifiedAt);
                if (!result || !result._id) throw new Error('no result returned');
                insertedThingIds.push(result._id);
            }
        } catch (error) {
            for (var id of insertedThingIds) {
                try { await things.del(userId, String(id)); } catch (rollbackError) {}
            }
            throw error;
        }
        return insertedThingIds;
    });
    return nodeify(promise, callback);
}

function extractArchive(filePath, tempExtractDir) {
    return new Promise(function (resolve, reject) {
        var finished = false;
        var entryCount = 0;
        var totalSize = 0;
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

        function done(error) {
            if (finished) return;
            finished = true;
            if (error) reject(error);
            else resolve();
        }

        input.on('error', done);
        extract.on('error', done);
        extract.on('finish', function () { done(); });
        input.pipe(extract);
    });
}

function importArchive(userId, filePath, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof filePath, 'string');

    var promise = Promise.resolve().then(async function () {
        var tempExtractDir = await files.mkdtemp(path.join(os.tmpdir(), 'meemo-import-'));
        var copiedFiles = [];

        try {
            await extractArchive(filePath, tempExtractDir);
            var thingsJsonPath = path.join(tempExtractDir, 'things.json');
            var rawContent;
            try {
                rawContent = await files.readFile(thingsJsonPath, 'utf8');
            } catch (error) {
                if (error.code === 'ENOENT') throw new Error('Archive missing things.json');
                throw error;
            }

            var data;
            try {
                data = JSON.parse(rawContent);
            } catch (error) {
                throw new Error('things.json is not valid JSON: ' + error.message);
            }
            var schemaError = validateThingsData(data);
            if (schemaError) throw new Error('Schema validation failed: ' + schemaError);

            for (var file of await files.readdir(tempExtractDir)) {
                if (file === 'things.json') continue;
                var sourcePath = path.join(tempExtractDir, file);
                if (!(await files.stat(sourcePath)).isFile()) continue;
                if (!isSafePathSegment(file)) throw new Error('Unsafe attachment filename in archive: ' + file);
                var copied = await storage.copyAttachment(userId, sourcePath, file);
                if (copied.created) copiedFiles.push(copied.path);
            }

            var insertedIds = await importData(userId, data);
            return { total: data.things.length, imported: insertedIds.length, failed: 0 };
        } catch (error) {
            await storage.removeFiles(copiedFiles);
            throw error;
        } finally {
            await files.rm(tempExtractDir, { recursive: true, force: true });
        }
    });
    return nodeify(promise, callback);
}

function importUploadedArchive(userId, filePath, callback) {
    var promise = importArchive(userId, filePath).finally(function () {
        return storage.removeFile(filePath);
    });
    return nodeify(promise, callback);
}

module.exports = {
    createExport: createExport,
    importUploadedArchive: importUploadedArchive,
    importArchive: importArchive,
    exportData: exportData,
    importData: importData,
    validateThingsData: validateThingsData
};
