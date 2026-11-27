'use strict';

var assert = require('assert'),
    fs = require('fs'),
    files = fs.promises,
    os = require('os'),
    path = require('path'),
    isSafePathSegment = require('../path-segment.js'),
    noteColors = require('../note-colors.js'),
    storage = require('../storage/local-storage.js'),
    tar = require('tar-fs'),
    thingService = require('./thing-service.js'),
    things = require('../database/things.js');

var MAX_ARCHIVE_ENTRIES = 1000;
var MAX_ARCHIVE_ENTRY_SIZE = 25 * 1024 * 1024;
var MAX_ARCHIVE_TOTAL_SIZE = 100 * 1024 * 1024;

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
        if (thing.revision !== undefined && (!Number.isSafeInteger(thing.revision) || thing.revision < 1)) {
            return 'Thing at index ' + i + ' has invalid revision';
        }
        if (thing.color !== undefined && !noteColors.isValidNoteColor(thing.color)) {
            return 'Thing at index ' + i + ' has invalid color';
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

async function exportData(userId) {
    return things.getAllLean(userId).then(function (result) {
        return {
            things: (result || []).map(function (thing) {
                return {
                    createdAt: thing.createdAt,
                    modifiedAt: thing.modifiedAt,
                    revision: thing.revision || 1,
                    content: thing.content,
                    externalContent: thing.externalContent || [],
                    attachments: thing.attachments || [],
                    color: thing.color || 'default'
                };
            })
        };
    });
}

async function createExport(userId, username) {
    var attachmentFolder = await storage.exportDirectory(userId, username);
    var result = await exportData(userId);

    var attachmentIdentifiers = Array.from(new Set(result.things.reduce(function (all, thing) {
        return all.concat((thing.attachments || []).map(function (attachment) {
            return typeof attachment === 'string' ? attachment : attachment.identifier;
        }));
    }, [])));
    for (var start = 0; start < attachmentIdentifiers.length; start += 16) {
        await Promise.all(attachmentIdentifiers.slice(start, start + 16).map(async function (identifier) {
            if (!isSafePathSegment(identifier)) throw new Error('Cannot export invalid attachment identifier: ' + identifier);
            var attachmentStat;
            try {
                attachmentStat = await files.lstat(path.join(attachmentFolder, identifier));
            } catch (error) {
                if (error.code === 'ENOENT') throw new Error('Cannot export missing attachment: ' + identifier);
                throw error;
            }
            if (!attachmentStat.isFile()) throw new Error('Cannot export unsupported attachment: ' + identifier);
        }));
    }
    var stream = tar.pack(attachmentFolder, {
        entries: attachmentIdentifiers,
        finalize: false,
        finish: function (pack) {
            pack.entry({ name: 'things.json' }, JSON.stringify(result));
            pack.finalize();
        },
        map: function (header) {
            header.name = 'attachments/' + header.name;
            return header;
        }
    });
    return stream;
}

async function importData(userId, data) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof data, 'object');

    var schemaError = validateThingsData(data);
    if (schemaError) throw new Error(schemaError);
    var state = { thingIds: [], thingRevisions: {} };

    try {
        await insertImportedData(userId, data, state);
    } catch (error) {
        throw addCleanupFailures(error, await rollbackImportedData(userId, state));
    }
    return state.thingIds;
}

async function insertImportedData(userId, data, state) {
    var BATCH_SIZE = 500;
    var prepared = data.things.map(function (thing) {
        var createdAt = thing.createdAt;
        if (typeof createdAt === 'string') createdAt = (new Date(createdAt)).getTime();
        if (typeof createdAt !== 'number' || isNaN(createdAt)) createdAt = Date.now();

        var modifiedAt = thing.modifiedAt;
        if (typeof modifiedAt === 'string') modifiedAt = (new Date(modifiedAt)).getTime();
        if (typeof modifiedAt !== 'number' || isNaN(modifiedAt)) modifiedAt = createdAt;

        return {
            content: thing.content,
            tags: thingService.extractTags(thing.content),
            attachments: Array.isArray(thing.attachments) ? thing.attachments : [],
            externalContent: Array.isArray(thing.externalContent) ? thing.externalContent : [],
            createdAt: createdAt,
            modifiedAt: modifiedAt,
            color: thing.color === undefined ? 'default' : thing.color
        };
    });

    for (var start = 0; start < prepared.length; start += BATCH_SIZE) {
        var chunk = prepared.slice(start, start + BATCH_SIZE);
        var registered = false;
        var inserted = await things.insertManyFull(userId, chunk, function (docs) {
            registered = true;
            for (var d = 0; d < docs.length; d++) {
                var preId = String(docs[d]._id);
                state.thingIds.push(preId);
                state.thingRevisions[preId] = 1;
            }
        });
        if (!Array.isArray(inserted) || inserted.length !== chunk.length) {
            throw new Error('no result returned');
        }
        if (!registered) {
            for (var i = 0; i < inserted.length; i++) {
                var doc = inserted[i];
                if (!doc || !doc._id) throw new Error('no result returned');
                state.thingIds.push(doc._id);
                state.thingRevisions[String(doc._id)] = doc.revision || 1;
            }
        }
    }
}

async function rollbackImportedData(userId, state) {
    var failures = [];
    for (var i = state.thingIds.length - 1; i >= 0; i--) {
        try {
            var thingId = String(state.thingIds[i]);
            await things.purge(userId, thingId, state.thingRevisions[thingId] || 1);
        } catch (error) {
            if (error && error.message === 'not found') continue;
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

async function importArchive(userId, filePath) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof filePath, 'string');

    var tempExtractDir = await files.mkdtemp(path.join(os.tmpdir(), 'meemo-import-'));
    var copiedFiles = [];
    var state = { thingIds: [], thingRevisions: {} };
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
}

async function importUploadedArchive(userId, filePath) {
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
}

module.exports = {
    createExport: createExport,
    importUploadedArchive: importUploadedArchive,
    importArchive: importArchive,
    importData: importData,
    validateThingsData: validateThingsData
};
