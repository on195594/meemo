/* jslint node:true */

'use strict';

var assert = require('assert'),
    path = require('path'),
    util = require('util'),
    safe = require('safetydance'),
    nodeify = require('../promise.js'),
    UserRepository = require('./user-repository.js');

function LegacyFileUserRepository(filePath) {
    UserRepository.call(this);
    this._filePath = filePath || null;
}
util.inherits(LegacyFileUserRepository, UserRepository);

LegacyFileUserRepository.prototype.getFilePath = function () {
    return path.resolve(this._filePath || process.env.USERS_FILE || '.users.json');
};

LegacyFileUserRepository.prototype._readUsers = function () {
    return safe.JSON.parse(safe.fs.readFileSync(this.getFilePath())) || null;
};

LegacyFileUserRepository.prototype._writeUsers = function (users) {
    if (!safe.fs.writeFileSync(this.getFilePath(), JSON.stringify(users, null, 4))) {
        throw safe.error || new Error('Could not write users file');
    }
};

LegacyFileUserRepository.prototype.get = function (id, callback) {
    var self = this;
    assert.strictEqual(typeof id, 'string');

    return nodeify(Promise.resolve().then(function () {
        var users = self._readUsers();
        if (!users || !users[id]) return null;
        var user = Object.assign({}, users[id]);
        user.id = user.id || user.username || id;
        return user;
    }), callback);
};

LegacyFileUserRepository.prototype.getByUsername = function (username, callback) {
    var self = this;
    assert.strictEqual(typeof username, 'string');

    return nodeify(Promise.resolve().then(function () {
        var users = self._readUsers();
        if (!users) return null;

        var foundKey = users[username] ? username : Object.keys(users).find(function (key) {
            return key.toLowerCase() === username.toLowerCase() ||
                (users[key].username && users[key].username.toLowerCase() === username.toLowerCase());
        });
        if (!foundKey) return null;

        var user = Object.assign({}, users[foundKey]);
        user.id = user.id || user.username || foundKey;
        return user;
    }), callback);
};

LegacyFileUserRepository.prototype.create = function (userData, callback) {
    var self = this;
    assert(userData && typeof userData === 'object');
    assert.strictEqual(typeof userData.username, 'string');

    return nodeify(Promise.resolve().then(function () {
        var users = self._readUsers() || {};
        if (users[userData.username]) throw new Error('user exists');

        var user = Object.assign({}, userData);
        user.id = user.id || user.username;
        users[userData.username] = user;
        self._writeUsers(users);
        return Object.assign({}, user);
    }), callback);
};

LegacyFileUserRepository.prototype.list = function (callback) {
    var self = this;
    return nodeify(Promise.resolve().then(function () {
        var users = self._readUsers();
        if (!users) return [];
        return Object.keys(users).map(function (key) {
            var user = Object.assign({}, users[key]);
            user.id = user.id || user.username || key;
            return user;
        });
    }), callback);
};

LegacyFileUserRepository.prototype.count = function (callback) {
    return nodeify(this.list().then(function (users) { return users.length; }), callback);
};

module.exports = LegacyFileUserRepository;
