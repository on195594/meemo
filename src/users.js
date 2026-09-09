/* jslint node:true */

'use strict';

exports = module.exports = {
    UserError,

    profile,
    list,
    count,
    create,
    verify,

    // Repository access
    UserRepository,
    LegacyFileUserRepository,
    MongoUserRepository,
    FallbackUserRepository,
    getRepository,
    setRepository,
    initRepository,
    getUsersFilePath
};

var assert = require('assert'),
    util = require('util'),
    bcrypt = require('bcrypt'),
    UserRepository = require('./database/user-repository.js'),
    LegacyFileUserRepository = require('./database/users-file.js'),
    MongoUserRepository = require('./database/users-mongo.js'),
    FallbackUserRepository = require('./database/users-fallback.js');

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

var g_repository = null;

function createRepositoryFromEnv() {
    var source = process.env.AUTH_USER_SOURCE || 'file';
    if (source === 'mongo') {
        return new MongoUserRepository();
    }
    if (source === 'fallback') {
        return new FallbackUserRepository(new MongoUserRepository(), new LegacyFileUserRepository());
    }
    return new LegacyFileUserRepository();
}

function getRepository() {
    if (!g_repository) {
        g_repository = createRepositoryFromEnv();
    }
    return g_repository;
}

function setRepository(repo) {
    g_repository = repo;
}

function initRepository(source) {
    if (source) process.env.AUTH_USER_SOURCE = source;
    g_repository = createRepositoryFromEnv();
    return g_repository;
}

function getUsersFilePath() {
    var repo = getRepository();
    if (repo && typeof repo.getFilePath === 'function') {
        return repo.getFilePath();
    }
    if (repo && repo.fallback && typeof repo.fallback.getFilePath === 'function') {
        return repo.fallback.getFilePath();
    }
    return null;
}

function profile(userId, full, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof full, 'boolean');
    assert.strictEqual(typeof callback, 'function');

    getRepository().get(userId, function (err, user) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
        if (!user) return callback(new UserError(UserError.NOT_FOUND));

        var result = {
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            passwordHash: full ? user.passwordHash : undefined
        };

        callback(null, result);
    });
}

function create(username, email, displayName, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof displayName, 'string');
    assert.strictEqual(typeof password, 'string');
    assert.strictEqual(typeof callback, 'function');

    getRepository().getByUsername(username, function (err, existing) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
        if (existing) return callback(new UserError('user exists'));

        bcrypt.hash(password, 10, function (err, hash) {
            if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));

            var userData = {
                username: username,
                displayName: displayName,
                email: email,
                passwordHash: hash
            };

            getRepository().create(userData, function (err) {
                if (err && err.message === 'user exists') return callback(new UserError('user exists'));
                if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
                callback(null);
            });
        });
    });
}

function verify(username, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof password, 'string');
    assert.strictEqual(typeof callback, 'function');

    getRepository().getByUsername(username, function (err, user) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
        if (!user) return callback(new UserError(UserError.NOT_FOUND));

        bcrypt.compare(password, user.passwordHash, function (err, result) {
            if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
            if (!result) return callback(new UserError(UserError.NOT_AUTHORIZED));
            callback(null);
        });
    });
}

function list(callback) {
    assert.strictEqual(typeof callback, 'function');

    getRepository().list(function (err, userList) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));

        var result = (userList || []).map(function (u) {
            return {
                username: u.username,
                displayName: u.displayName
            };
        });

        callback(null, result);
    });
}

function count(callback) {
    assert.strictEqual(typeof callback, 'function');

    getRepository().count(function (err, num) {
        if (err) return callback(new UserError(UserError.INTERNAL_ERROR, err));
        callback(null, num);
    });
}
