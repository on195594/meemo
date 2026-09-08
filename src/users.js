/* jslint node:true */

'use strict';

exports = module.exports = {
    UserError,

    upsert,
    profile,
    list,
    create,
    verify,
};

var assert = require('assert'),
    path = require('path'),
    safe = require('safetydance'),
    util = require('util'),
    bcrypt = require('bcrypt');

function UserError(code, messageOrError) {
    assert.strictEqual(typeof code, 'string');

    Error.call(this);
    Error.captureStackTrace(this, this.constructor);

    this.code = code;
    this.message = messageOrError || code;
}
util.inherits(UserError, Error);

UserError.NOT_FOUND = 'not found';
UserError.NOT_AUTHORIZED = 'not authorized';
UserError.INTERNAL_ERROR = 'internal error';

const USERS_FILEPATH = path.resolve(process.env.CLOUDRON_LOCAL_AUTH_FILE || process.env.CLOUDRON_USERS_FILEPATH || '.users.json');

function upsert(username, email, displayName) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof displayName, 'string');

    const users = safe.JSON.parse(safe.fs.readFileSync(USERS_FILEPATH)) || {};
    const existingUser = users[username];
    users[username] = {
        username,
        displayName,
        email,
        passwordHash: existingUser ? existingUser.passwordHash : undefined
    };

    safe.fs.writeFileSync(USERS_FILEPATH, JSON.stringify(users, null, 4));
}

function profile(userId, full, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof full, 'boolean');
    assert.strictEqual(typeof callback, 'function');

    const users = safe.JSON.parse(safe.fs.readFileSync(USERS_FILEPATH));
    if (!users) return callback(new UserError(UserError.NOT_FOUND));
    if (!users[userId]) return callback(new UserError(UserError.NOT_FOUND));

    const result = {
        username: users[userId].username,
        displayName: users[userId].displayName,
        email: users[userId].email,
        passwordHash: full ? users[userId].passwordHash : undefined
    };

    callback(null, result);
}

function create(username, email, displayName, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof displayName, 'string');
    assert.strictEqual(typeof password, 'string');
    assert.strictEqual(typeof callback, 'function');

    const users = safe.JSON.parse(safe.fs.readFileSync(USERS_FILEPATH)) || {};
    if (users[username]) return callback(new UserError('user exists'));

    bcrypt.hash(password, 10, function(err, hash) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));

        users[username] = {
            username,
            displayName,
            email,
            passwordHash: hash
        };

        safe.fs.writeFileSync(USERS_FILEPATH, JSON.stringify(users, null, 4));
        callback(null);
    });
}

function verify(username, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof password, 'string');
    assert.strictEqual(typeof callback, 'function');

    const users = safe.JSON.parse(safe.fs.readFileSync(USERS_FILEPATH));
    if (!users) return callback(new UserError(UserError.NOT_FOUND));
    if (!users[username]) return callback(new UserError(UserError.NOT_FOUND));

    bcrypt.compare(password, users[username].passwordHash, function(err, result) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
        if (!result) return callback(new UserError(UserError.NOT_AUTHORIZED));
        callback(null);
    });
}

function list(callback) {
    var users = safe.JSON.parse(safe.fs.readFileSync(USERS_FILEPATH));
    if (!users) return callback(null, []);

    var result = Object.keys(users).map(function (u) {
        return {
            username: users[u].username,
            displayName: users[u].displayName
        };
    });

    callback(null, result);
}
