/* jslint node:true */

'use strict';

var assert = require('assert'),
    util = require('util'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    nodeify = require('../promise.js'),
    UserRepository = require('./user-repository.js');

function MongoUserRepository(db) {
    UserRepository.call(this);
    this._db = db || null;
    this._indexesCreated = false;
}
util.inherits(MongoUserRepository, UserRepository);

function isDuplicateKey(error) {
    return error.code === 11000 || (error.message && error.message.indexOf('E11000') !== -1);
}

MongoUserRepository.prototype.getCollection = function () {
    var collection = (this._db || config.db).collection('users');
    var self = this;

    if (!this._indexesCreated) {
        this._indexesCreated = true;
        collection.createIndex({ usernameNorm: 1 }, { unique: true }).catch(function (error) {
            if (error.codeName !== 'IndexOptionsConflict') {
                console.error('Warning: could not create users.usernameNorm unique index:', error);
            }
            self._indexesCreated = false;
        });
    }
    return collection;
};

MongoUserRepository.prototype.ensureIndexes = function (callback) {
    var self = this;
    var promise = Promise.resolve().then(function () {
        var db = self._db || config.db;
        if (!db) throw new Error('MongoDB database is not connected');
        return db.collection('users').createIndex({ usernameNorm: 1 }, { unique: true });
    }).then(function () {
        self._indexesCreated = true;
    }).catch(function (error) {
        if (error.codeName === 'IndexOptionsConflict') {
            self._indexesCreated = true;
            return;
        }
        throw error;
    });
    return nodeify(promise, callback);
};

MongoUserRepository.prototype.claimFirstUserRegistration = function (callback) {
    var self = this;
    var promise = Promise.resolve().then(function () {
        var db = self._db || config.db;
        if (!db) throw new Error('MongoDB database is not connected');
        return db.collection('system_config').insertOne({ _id: 'registration-initialized' });
    }).then(function () {
        return true;
    }).catch(function (error) {
        if (isDuplicateKey(error)) return false;
        throw error;
    });
    return nodeify(promise, callback);
};

MongoUserRepository.prototype.releaseFirstUserRegistration = function (callback) {
    var self = this;
    var promise = Promise.resolve().then(function () {
        var db = self._db || config.db;
        if (!db) throw new Error('MongoDB database is not connected');
        return db.collection('system_config').deleteOne({ _id: 'registration-initialized' });
    });
    return nodeify(promise, callback);
};

function mapUser(doc, includePassword) {
    if (!doc) return null;
    return {
        id: String(doc._id),
        username: doc.username,
        displayName: doc.displayName,
        email: doc.email,
        passwordHash: includePassword ? doc.passwordHash : undefined,
        createdAt: doc.createdAt,
        status: doc.status || 'active'
    };
}

MongoUserRepository.prototype.get = function (id, callback) {
    var self = this;
    assert.strictEqual(typeof id, 'string');

    var norm = id.toLowerCase();
    var conditions = [{ usernameNorm: norm }, { username: id }];
    if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) conditions.unshift({ _id: new ObjectId(id) });

    return nodeify(Promise.resolve().then(function () {
        return self.getCollection().findOne({ $or: conditions });
    }).then(function (doc) {
        return mapUser(doc, true);
    }), callback);
};

MongoUserRepository.prototype.getByUsername = function (username, callback) {
    var self = this;
    assert.strictEqual(typeof username, 'string');

    return nodeify(Promise.resolve().then(function () {
        return self.getCollection().findOne({ usernameNorm: username.toLowerCase() });
    }).then(function (doc) {
        return mapUser(doc, true);
    }), callback);
};

MongoUserRepository.prototype.create = function (userData, callback) {
    var self = this;
    assert(userData && typeof userData === 'object');
    assert.strictEqual(typeof userData.username, 'string');

    var promise = this.getByUsername(userData.username).then(function (existing) {
        if (existing) throw new Error('user exists');

        var doc = {
            username: userData.username,
            usernameNorm: userData.username.toLowerCase(),
            displayName: userData.displayName,
            email: userData.email,
            passwordHash: userData.passwordHash,
            createdAt: typeof userData.createdAt === 'number' ? userData.createdAt : Date.now(),
            status: userData.status || 'active'
        };
        if (userData.id && ObjectId.isValid(userData.id)) doc._id = new ObjectId(userData.id);

        return self.getCollection().insertOne(doc).then(function (result) {
            return Object.assign({}, doc, { id: String(result.insertedId || doc._id) });
        });
    }).catch(function (error) {
        if (isDuplicateKey(error)) {
            throw new Error('user exists');
        }
        throw error;
    });

    return nodeify(promise, callback);
};

MongoUserRepository.prototype.list = function (callback) {
    var self = this;
    return nodeify(Promise.resolve().then(function () {
        return self.getCollection().find({ status: { $ne: 'disabled' } }).sort({ username: 1 }).toArray();
    }).then(function (docs) {
        return (docs || []).map(function (doc) { return mapUser(doc, false); });
    }), callback);
};

MongoUserRepository.prototype.count = function (callback) {
    var self = this;
    return nodeify(Promise.resolve().then(function () {
        return self.getCollection().countDocuments({ status: { $ne: 'disabled' } });
    }), callback);
};

module.exports = MongoUserRepository;
