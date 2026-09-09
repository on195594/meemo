'use strict';

var config = require('../config.js'),
    fs = require('fs'),
    mkdirp = require('mkdirp'),
    path = require('path');

function userDirectory(userId) {
    return path.join(config.attachmentDir, userId);
}

function ensureUserDirectory(userId) {
    var directory = userDirectory(userId);
    mkdirp.sync(directory);
    return directory;
}

function saveAttachment(userId, storageKey, buffer, callback) {
    var target = path.join(ensureUserDirectory(userId), storageKey);

    fs.writeFile(target, buffer, function (error) {
        if (!error) return callback(null);
        fs.unlink(target, function () {});
        callback(error);
    });
}

function resolveAttachmentRoot(userId, username, storageKey) {
    var root = userDirectory(userId);
    if (!fs.existsSync(path.join(root, storageKey)) && username && username !== userId) {
        var legacyRoot = userDirectory(username);
        if (fs.existsSync(path.join(legacyRoot, storageKey))) root = legacyRoot;
    }
    return root;
}

function exportDirectory(userId, username) {
    var directory = userDirectory(userId);
    if (!fs.existsSync(directory) && username && username !== userId && fs.existsSync(userDirectory(username))) {
        directory = userDirectory(username);
    }
    mkdirp.sync(directory);
    return directory;
}

function copyAttachment(userId, sourcePath, storageKey) {
    var target = path.join(ensureUserDirectory(userId), storageKey);
    var created = !fs.existsSync(target);
    fs.copyFileSync(sourcePath, target);
    return { path: target, created: created };
}

function removeFiles(files) {
    files.forEach(function (file) {
        try { fs.rmSync(file, { force: true }); } catch (error) {}
    });
}

function removeFile(file) {
    try { fs.rmSync(file, { force: true }); } catch (error) {}
}

function checkAccess() {
    mkdirp.sync(config.attachmentDir);
    fs.accessSync(config.attachmentDir, fs.constants.R_OK | fs.constants.W_OK);
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
