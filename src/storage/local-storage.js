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

module.exports = {
    userDirectory: userDirectory,
    ensureUserDirectory: ensureUserDirectory,
    saveAttachment: saveAttachment,
    resolveAttachmentRoot: resolveAttachmentRoot,
    exportDirectory: exportDirectory,
    copyAttachment: copyAttachment,
    removeFiles: removeFiles,
    removeFile: removeFile,
    checkAccess: checkAccess
};
