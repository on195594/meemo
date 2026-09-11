'use strict';

var config = require('../config.js'),
    fs = require('fs').promises,
    path = require('path');

function userDirectory(userId) {
    return path.join(config.attachmentDir, userId);
}

async function ensureUserDirectory(userId) {
    var directory = userDirectory(userId);
    await fs.mkdir(directory, { recursive: true });
    return directory;
}

async function saveAttachment(userId, storageKey, buffer) {
    var target = path.join(await ensureUserDirectory(userId), storageKey);
    try {
        await fs.writeFile(target, buffer);
    } catch (error) {
        try { await fs.rm(target, { force: true }); } catch (cleanupError) {}
        throw error;
    }
}

async function resolveAttachmentRoot(userId, username, storageKey) {
    var root = userDirectory(userId);
    try {
        await fs.access(path.join(root, storageKey));
    } catch (error) {
        if (username && username !== userId) {
            var legacyRoot = userDirectory(username);
            try {
                await fs.access(path.join(legacyRoot, storageKey));
                root = legacyRoot;
            } catch (legacyError) {}
        }
    }
    return root;
}

async function exportDirectory(userId, username) {
    var directory = userDirectory(userId);
    try {
        await fs.access(directory);
    } catch (error) {
        if (username && username !== userId) {
            try {
                await fs.access(userDirectory(username));
                directory = userDirectory(username);
            } catch (legacyError) {}
        }
    }
    await fs.mkdir(directory, { recursive: true });
    return directory;
}

async function copyAttachment(userId, sourcePath, storageKey) {
    var target = path.join(await ensureUserDirectory(userId), storageKey);
    await fs.copyFile(sourcePath, target, require('fs').constants.COPYFILE_EXCL);
    return { path: target, created: true };
}

async function removeFiles(files) {
    var failures = [];
    for (var file of files) {
        try {
            await fs.rm(file, { force: true });
        } catch (error) {
            failures.push({ file: file, error: error });
        }
    }
    return failures;
}

async function removeFile(file) {
    await fs.rm(file, { force: true });
}

async function checkAccess() {
    await fs.mkdir(config.attachmentDir, { recursive: true });
    await fs.access(config.attachmentDir, require('fs').constants.R_OK | require('fs').constants.W_OK);
}

function isSafePathSegment(segment) {
    return typeof segment === 'string' && segment && path.basename(segment) === segment && segment !== '.' && segment !== '..' && segment.indexOf('\0') === -1;
}

async function listAttachments() {
    var root = path.resolve(config.attachmentDir);
    var rootStat;
    try {
        rootStat = await fs.lstat(root);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Unsafe attachment root: ' + root);

    var result = [];
    var userEntries = await fs.readdir(root, { withFileTypes: true });
    userEntries.sort(function (left, right) { return left.name.localeCompare(right.name); });
    for (var userEntry of userEntries) {
        if (!isSafePathSegment(userEntry.name) || !userEntry.isDirectory() || userEntry.isSymbolicLink()) {
            throw new Error('Unsafe attachment path: ' + userEntry.name);
        }
        var userRoot = path.join(root, userEntry.name);
        var fileEntries = await fs.readdir(userRoot, { withFileTypes: true });
        fileEntries.sort(function (left, right) { return left.name.localeCompare(right.name); });
        for (var fileEntry of fileEntries) {
            if (!isSafePathSegment(fileEntry.name) || !fileEntry.isFile() || fileEntry.isSymbolicLink()) {
                throw new Error('Unsafe attachment path: ' + userEntry.name + '/' + fileEntry.name);
            }
            var filePath = path.join(userRoot, fileEntry.name);
            var stat = await fs.lstat(filePath);
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Unsafe attachment path: ' + userEntry.name + '/' + fileEntry.name);
            result.push({ root: userEntry.name, identifier: fileEntry.name, path: filePath, mtimeMs: stat.mtimeMs });
        }
    }
    return result;
}

module.exports = {
    userDirectory: userDirectory,
    ensureUserDirectory: ensureUserDirectory,
    saveAttachment: saveAttachment,
    resolveAttachmentRoot: resolveAttachmentRoot,
    exportDirectory: exportDirectory,
    copyAttachment: copyAttachment,
    removeFiles: removeFiles,
    removeFile: removeFile,
    checkAccess: checkAccess,
    listAttachments: listAttachments
};
