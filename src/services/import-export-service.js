'use strict';

var assert = require('assert'),
    fs = require('fs'),
    files = fs.promises,
    os = require('os'),
    path = require('path'),
    nodeify = require('../promise.js'),
    storage = require('../storage/local-storage.js'),
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

async function buildAttachmentManifest(tempExtractDir, data) {
    var rootEntries = await files.readdir(tempExtractDir, { withFileTypes: true });
    rootEntries.sort(function (left, right) { return left.name.localeCompare(right.name); });
    var attachmentDirectory = null;

    for (var rootEntry of rootEntries) {
        if (rootEntry.name === 'things.json' && rootEntry.isFile()) continue;
        if (rootEntry.name === 'attachments' && rootEntry.isDirectory()) {
            attachmentDirectory = path.join(tempExtractDir, rootEntry.name);
            continue;
        }
        throw new Error('Archive contains unsupported root entry: ' + rootEntry.name);
    }

    var manifest = [];
    if (attachmentDirectory) {
        var entries = await files.readdir(attachmentDirectory, { withFileTypes: true });
        entries.sort(function (left, right) { return left.name.localeCompare(right.name); });
        for (var entry of entries) {
            if (!entry.isFile() || !isSafePathSegment(entry.name)) {
                throw new Error('Archive contains nested or unsupported attachment entry: ' + entry.name);
            }
            manifest.push({ identifier: entry.name, sourcePath: path.join(attachmentDirectory, entry.name) });
        }
    }

    var referenced = new Set();
    for (var thing of data.things) {
        for (var attachment of thing.attachments || []) {
            var identifier = typeof attachment === 'string' ? attachment : attachment.identifier;
            referenced.add(identifier);
        }
    }

    var staged = new Set(manifest.map(function (entry) { return entry.identifier; }));
    for (var identifier of referenced) {
        if (!staged.has(identifier)) throw new Error('Archive missing referenced attachment: ' + identifier);
    }
    for (var stagedIdentifier of staged) {
        if (!referenced.has(stagedIdentifier)) throw new Error('Archive contains unreferenced attachment: ' + stagedIdentifier);
    }
    return manifest;
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
                    attachments: thing.attachments || [],
                    color: thing.color || 'default'
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

        var attachmentIdentifiers = Array.from(new Set(result.things.reduce(function (all, thing) {
            return all.concat((thing.attachments || []).map(function (attachment) {
                return typeof attachment === 'string' ? attachment : attachment.identifier;
            }));
        }, [])));
        for (var identifier of attachmentIdentifiers) {
            if (!isSafePathSegment(identifier)) throw new Error('Cannot export invalid attachment identifier: ' + identifier);
            var attachmentStat;
            try {
                attachmentStat = await files.lstat(path.join(attachmentFolder, identifier));
            } catch (error) {
                if (error.code === 'ENOENT') throw new Error('Cannot export missing attachment: ' + identifier);
                throw error;
            }
            if (!attachmentStat.isFile()) throw new Error('Cannot export unsupported attachment: ' + identifier);
        }
        var stream = tar.pack(attachmentFolder, {
            entries: attachmentIdentifiers,
            finalize: false,
            finish: function (pack) {
                pack.entry({ name: 'things.json' }, JSON.stringify(result, null, 4));
                pack.finalize();
            },
            map: function (header) {
                header.name = 'attachments/' + header.name;
                return header;
            }
        });
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
        var state = { thingIds: [] };

        try {
            await insertImportedData(userId, data, state);
        } catch (error) {
            throw addCleanupFailures(error, await rollbackImportedData(userId, state));
        }
        return state.thingIds;
    });
    return nodeify(promise, callback);
}

async function insertImportedData(userId, data, state) {
    for (var thing of data.things) {
        var tagObjects = thingService.extractTags(thing.content);
        var createdAt = thing.createdAt;
        if (typeof createdAt === 'string') createdAt = (new Date(createdAt)).getTime();
        if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();

        var modifiedAt = thing.modifiedAt;
        if (typeof modifiedAt === 'string') modifiedAt = (new Date(modifiedAt)).getTime();
        if (typeof modifiedAt !== 'number' || isNaN(modifiedAt)) modifiedAt = createdAt;

        var color = typeof thing.color === 'string' ? thing.color : 'default';
        var result = await things.insertFull(userId, thing.content, tagObjects,
            Array.isArray(thing.attachments) ? thing.attachments : [],
            Array.isArray(thing.externalContent) ? thing.externalContent : [], createdAt, modifiedAt, color);
        if (!result || !result._id) throw new Error('no result returned');
        state.thingIds.push(result._id);
        await things.get(userId, result._id);
    }
}

async function rollbackImportedData(userId, state) {
    var failures = [];
    for (var i = state.thingIds.length - 1; i >= 0; i--) {
        try {
            await things.del(userId, String(state.thingIds[i]));
        } catch (error) {
            failures.push({ operation: 'remove imported thing', target: String(state.thingIds[i]), error: error });
        }
    }
    return failures;
}

function addCleanupFailures(error, failures) {
    if (!failures.length) return error;
    if (!error || typeof error !== 'object') {
        var original = error;
        error = new Error(String(original));
        error.cause = original;
    }
    error.cleanupErrors = (error.cleanupErrors || []).concat(failures);
    error.message += '; rollback/cleanup incomplete: ' + failures.map(function (failure) {
        return failure.operation + ' ' + failure.target + ': ' + failure.error.message;
    }).join('; ');
    return error;
}

function addCleanupWarning(result, failure) {
    result.cleanupWarnings = (result.cleanupWarnings || []).concat([{
        operation: failure.operation,
        target: failure.target,
        message: failure.error.message
    }]);
}

function extractArchive(filePath, tempExtractDir) {
    return new Promise(function (resolve, reject) {
        var finished = false;
        var entryCount = 0;
        var totalSize = 0;
        var seenEntries = new Set();
        var input = fs.createReadStream(filePath);
        var extract = tar.extract(tempExtractDir, {
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

                var normalizedName = typeof header.name === 'string' ? path.posix.normalize(header.name.replace(/\\/g, '/')) : '';
                if (!error && seenEntries.has(normalizedName)) {
                    if (header.type === 'file' && normalizedName.indexOf('attachments/') === 0) {
                        error = new Error('Archive contains duplicate mapped attachment identifier: ' + normalizedName.slice('attachments/'.length));
                    } else {
                        error = new Error('Archive contains duplicate entry: ' + header.name);
                    }
                }
                seenEntries.add(normalizedName);

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
        var state = { thingIds: [] };
        var result;
        var primaryError;

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
            var manifest = await buildAttachmentManifest(tempExtractDir, data);

            await insertImportedData(userId, data, state);

            for (var entry of manifest) {
                var copied = await storage.copyAttachment(userId, entry.sourcePath, entry.identifier);
                copiedFiles.push(copied.path);
            }

            result = { total: data.things.length, imported: state.thingIds.length, failed: 0 };
        } catch (error) {
            var failures = await rollbackImportedData(userId, state);
            try {
                var fileFailures = await storage.removeFiles(copiedFiles);
                failures = failures.concat(fileFailures.map(function (failure) {
                    return { operation: 'remove imported attachment', target: path.basename(failure.file), error: failure.error };
                }));
            } catch (cleanupError) {
                failures.push({ operation: 'remove imported attachments', target: '<all>', error: cleanupError });
            }
            primaryError = addCleanupFailures(error, failures);
        }

        try {
            await files.rm(tempExtractDir, { recursive: true, force: true });
        } catch (cleanupError) {
            var failure = {
                operation: 'remove temporary extraction directory',
                target: path.basename(tempExtractDir),
                error: cleanupError
            };
            if (primaryError) primaryError = addCleanupFailures(primaryError, [failure]);
            else addCleanupWarning(result, failure);
        }
        if (primaryError) throw primaryError;
        return result;
    });
    return nodeify(promise, callback);
}

function importUploadedArchive(userId, filePath, callback) {
    var promise = Promise.resolve().then(async function () {
        var result;
        var primaryError;
        try {
            result = await importArchive(userId, filePath);
        } catch (error) {
            primaryError = error;
        }
        try {
            await storage.removeFile(filePath);
        } catch (cleanupError) {
            var failure = {
                operation: 'remove uploaded archive', target: path.basename(filePath), error: cleanupError
            };
            if (primaryError) primaryError = addCleanupFailures(primaryError, [failure]);
            else addCleanupWarning(result, failure);
        }
        if (primaryError) throw primaryError;
        return result;
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
