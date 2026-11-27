/* jslint node:true */

'use strict';

var assert = require('assert'),
    bcrypt = require('bcrypt'),
    MongoUserRepository = require('./database/users-mongo.js');

class UserError extends Error {
    constructor(code, messageOrError) {
        assert.strictEqual(typeof code, 'string');
        super(messageOrError || code);
        this.name = 'UserError';
        this.code = code;
    }
}

UserError.NOT_FOUND = 'not found';
UserError.NOT_AUTHORIZED = 'not authorized';
UserError.INTERNAL_ERROR = 'internal error';

var repository = null;

function assertMongoUserSource(source, isProduction) {
    var effective = source || process.env.AUTH_USER_SOURCE || 'mongo';
    var prod = isProduction !== undefined ? isProduction : (process.env.NODE_ENV === 'production');
    if (effective !== 'mongo') {
        if (prod) {
            throw new Error('FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production');
        }
        throw new Error('Unsupported AUTH_USER_SOURCE: ' + effective);
    }
    return effective;
}

function getRepository() {
    if (!repository) {
        assertMongoUserSource();
        repository = new MongoUserRepository();
    }
    return repository;
}

function setRepository(value) {
    repository = value;
}

async function profile(userId, full) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof full, 'boolean');

    return getRepository().get(userId).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            email: user.email,
            passwordHash: full ? user.passwordHash : undefined
        };
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
}

async function resolveUser(identifier) {
    assert.strictEqual(typeof identifier, 'string');

    return getRepository().get(identifier).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return {
            id: user.id,
            username: user.username || identifier,
            displayName: user.displayName || user.username,
            email: user.email
        };
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
}

async function create(username, email, displayName, password) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof email, 'string');
    assert.strictEqual(typeof displayName, 'string');
    assert.strictEqual(typeof password, 'string');

    var repo = getRepository();
    return repo.getByUsername(username).then(function (existing) {
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
}

async function verify(username, password) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof password, 'string');

    return getRepository().getByUsername(username).then(function (user) {
        if (!user) throw new UserError(UserError.NOT_FOUND);
        return bcrypt.compare(password, user.passwordHash).then(function (valid) {
            if (!valid) throw new UserError(UserError.NOT_AUTHORIZED);
            return user;
        });
    }).catch(function (error) {
        if (error instanceof UserError) throw error;
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
}

async function list() {
    return getRepository().list().then(function (users) {
        return (users || []).map(function (user) {
            return { username: user.username, displayName: user.displayName };
        });
    }).catch(function (error) {
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
}

async function count() {
    return getRepository().count().catch(function (error) {
        throw new UserError(UserError.INTERNAL_ERROR, error);
    });
}

module.exports = {
    UserError: UserError,
    profile: profile,
    list: list,
    count: count,
    create: create,
    verify: verify,
    resolveUser: resolveUser,
    MongoUserRepository: MongoUserRepository,
    assertMongoUserSource: assertMongoUserSource,
    getRepository: getRepository,
    setRepository: setRepository
};
