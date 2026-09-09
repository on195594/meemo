/* jslint node:true */

'use strict';

var assert = require('assert'),
    path = require('path'),
    util = require('util'),
    safe = require('safetydance'),
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
    return safe.fs.writeFileSync(this.getFilePath(), JSON.stringify(users, null, 4));
};

LegacyFileUserRepository.prototype.get = function (id, callback) {
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(typeof callback, 'function');

    var users = this._readUsers();
    if (!users || !users[id]) return callback(null, null);

    var u = Object.assign({}, users[id]);
    u.id = u.id || u.username || id;
    callback(null, u);
};

LegacyFileUserRepository.prototype.getByUsername = function (username, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof callback, 'function');

    var users = this._readUsers();
    if (!users) return callback(null, null);

    if (users[username]) {
        var u = Object.assign({}, users[username]);
        u.id = u.id || u.username || username;
        return callback(null, u);
    }

    var norm = username.toLowerCase();
    var foundKey = Object.keys(users).find(function (k) {
        return k.toLowerCase() === norm || (users[k].username && users[k].username.toLowerCase() === norm);
    });

    if (foundKey) {
        var u = Object.assign({}, users[foundKey]);
        u.id = u.id || u.username || foundKey;
        return callback(null, u);
    }

    callback(null, null);
};

LegacyFileUserRepository.prototype.create = function (userData, callback) {
    assert.strictEqual(typeof userData, 'object');
    assert(userData !== null);
    assert.strictEqual(typeof userData.username, 'string');
    assert.strictEqual(typeof callback, 'function');

    var users = this._readUsers() || {};
    if (users[userData.username]) {
        return callback(new Error('user exists'));
    }

    var u = Object.assign({}, userData);
    u.id = u.id || u.username;
    users[userData.username] = u;
    this._writeUsers(users);

    callback(null, Object.assign({}, u));
};

LegacyFileUserRepository.prototype.list = function (callback) {
    assert.strictEqual(typeof callback, 'function');

    var users = this._readUsers();
    if (!users) return callback(null, []);

    var list = Object.keys(users).map(function (k) {
        var u = Object.assign({}, users[k]);
        u.id = u.id || u.username || k;
        return u;
    });

    callback(null, list);
};

LegacyFileUserRepository.prototype.count = function (callback) {
    assert.strictEqual(typeof callback, 'function');

    this.list(function (err, list) {
        if (err) return callback(err);
        callback(null, list.length);
    });
};

module.exports = LegacyFileUserRepository;
