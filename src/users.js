/* jslint node:true */

'use strict';

var assert = require('assert'),
    util = require('util'),
    bcrypt = require('bcrypt'),
    nodeify = require('./promise.js'),
    UserRepository = require('./database/user-repository.js'),
    MongoUserRepository = require('./database/users-mongo.js');

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

var repository = null;

/**
 * Resolves account repository from AUTH_USER_SOURCE.
 * Runtime exclusively targets MongoUserRepository ('mongo').
 */
function createRepositoryFromEnv() {
    var source = process.env.AUTH_USER_SOURCE || 'mongo';
    var isProduction = process.env.NODE_ENV === 'production';
    if (isProduction && source !== 'mongo') {
        throw new Error('FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production');
    }
    if (source === 'mongo') return new MongoUserRepository();
    throw new Error('Unsupported AUTH_USER_SOURCE: ' + source);
}

function getRepository() {
    if (!repository) repository = createRepositoryFromEnv();
    return repository;
}

function setRepository(value) {
    repository = value;
}

function initRepository(source) {
    if (source) process.env.AUTH_USER_SOURCE = source;
    repository = createRepositoryFromEnv();
    return repository;
}

function profile(userId, full, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof full, 'boolean');

    var promise = getRepository().get(userId).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return {
            id: user.id || user.username || userId,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            passwordHash: full ? user.passwordHash : undefined
        };
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

function resolveUser(identifier, callback) {
    assert.strictEqual(typeof identifier, 'string');

    var repo = getRepository();
    var promise = repo.get(identifier).then(function (user) {
        return user || repo.getByUsername(identifier);
    }).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return {
            id: user.id || user.username || identifier,
            username: user.username || identifier,
            displayName: user.displayName || user.username,
            email: user.email
        };
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

function create(username, email, displayName, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof displayName, 'string');
    assert.strictEqual(typeof password, 'string');

    var repo = getRepository();
    var promise = repo.getByUsername(username).then(function (existing) {
        if (existing) throw new UserError('user exists');
        return bcrypt.hash(password, 10);
    }).then(function (passwordHash) {
        return repo.create({
            username: username,
            displayName: displayName,
            email: email,
            passwordHash: passwordHash
        });
    }).then(function () {
        return undefined;
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        if (error.message === 'user exists') throw new UserError('user exists');
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

function verify(username, password, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof password, 'string');

    var promise = getRepository().getByUsername(username).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return bcrypt.compare(password, user.passwordHash).then(function (valid) {
            if (!valid) throw new UserError(UserError.NOT_AUTHORIZED);
            return user;
        });
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

function list(callback) {
    var promise = getRepository().list().then(function (users) {
        return (users || []).map(function (user) {
            return { username: user.username, displayName: user.displayName };
        });
    }).catch(function (error) {
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

function count(callback) {
    var promise = getRepository().count().catch(function (error) {
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
    return nodeify(promise, callback);
}

module.exports = {
    UserError: UserError,
    profile: profile,
    list: list,
    count: count,
    create: create,
    verify: verify,
    resolveUser: resolveUser,
    UserRepository: UserRepository,
    MongoUserRepository: MongoUserRepository,
    getRepository: getRepository,
    setRepository: setRepository,
    initRepository: initRepository
};
