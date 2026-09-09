/* jslint node:true */

'use strict';

var assert = require('assert'),
    util = require('util'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    UserRepository = require('./user-repository.js');

function MongoUserRepository(db) {
    UserRepository.call(this);
    this._db = db || null;
    this._indexesCreated = false;
}
util.inherits(MongoUserRepository, UserRepository);

MongoUserRepository.prototype.getCollection = function () {
    var db = this._db || config.db;
    if (!db) throw new Error('MongoDB database is not connected');

    var collection = db.collection('users');

    if (!this._indexesCreated) {
        this._indexesCreated = true;
        collection.createIndex({ usernameNorm: 1 }, { unique: true }, function (err) {
            if (err && err.codeName !== 'IndexOptionsConflict') {
                console.error('Warning: could not create users.usernameNorm unique index:', err);
            }
        });
    }

    return collection;
};

MongoUserRepository.prototype.ensureIndexes = function (callback) {
    assert.strictEqual(typeof callback, 'function');
    var db = this._db || config.db;
    if (!db) return callback(new Error('MongoDB database is not connected'));

    var self = this;
    var collection = db.collection('users');
    collection.createIndex({ usernameNorm: 1 }, { unique: true }, function (err) {
        if (err && err.codeName !== 'IndexOptionsConflict') return callback(err);
        self._indexesCreated = true;
        callback(null);
    });
};

MongoUserRepository.prototype.get = function (id, callback) {
    assert.strictEqual(typeof id, 'string');
    assert.strictEqual(typeof callback, 'function');

    var query;
    var norm = id.toLowerCase();

    if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) {
        query = {
            $or: [
                { _id: new ObjectId(id) },
                { usernameNorm: norm },
                { username: id }
            ]
        };
    } else {
        query = {
            $or: [
                { usernameNorm: norm },
                { username: id }
            ]
        };
    }

    try {
        this.getCollection().findOne(query, function (err, doc) {
            if (err) return callback(err);
            if (!doc) return callback(null, null);

            var user = {
                id: String(doc._id),
                username: doc.username,
                displayName: doc.displayName,
                email: doc.email,
                passwordHash: doc.passwordHash,
                createdAt: doc.createdAt,
                status: doc.status || 'active'
            };

            callback(null, user);
        });
    } catch (e) {
        callback(e);
    }
};

MongoUserRepository.prototype.getByUsername = function (username, callback) {
    assert.strictEqual(typeof username, 'string');
    assert.strictEqual(typeof callback, 'function');

    var norm = username.toLowerCase();
    try {
        this.getCollection().findOne({ usernameNorm: norm }, function (err, doc) {
            if (err) return callback(err);
            if (!doc) return callback(null, null);

            var user = {
                id: String(doc._id),
                username: doc.username,
                displayName: doc.displayName,
                email: doc.email,
                passwordHash: doc.passwordHash,
                createdAt: doc.createdAt,
                status: doc.status || 'active'
            };

            callback(null, user);
        });
    } catch (e) {
        callback(e);
    }
};

MongoUserRepository.prototype.create = function (userData, callback) {
    assert.strictEqual(typeof userData, 'object');
    assert(userData !== null);
    assert.strictEqual(typeof userData.username, 'string');
    assert.strictEqual(typeof callback, 'function');

    var self = this;
    var norm = userData.username.toLowerCase();

    this.getByUsername(userData.username, function (err, existing) {
        if (err) return callback(err);
        if (existing) return callback(new Error('user exists'));

        var doc = {
            username: userData.username,
            usernameNorm: norm,
            displayName: userData.displayName,
            email: userData.email,
            passwordHash: userData.passwordHash,
            createdAt: typeof userData.createdAt === 'number' ? userData.createdAt : Date.now(),
            status: userData.status || 'active'
        };

        if (userData.id && ObjectId.isValid(userData.id)) {
            doc._id = new ObjectId(userData.id);
        }

        try {
            self.getCollection().insertOne(doc, function (err, result) {
                if (err) {
                    // MongoDB duplicate key error (code 11000)
                    if (err.code === 11000 || (err.message && err.message.indexOf('E11000') !== -1)) {
                        return callback(new Error('user exists'));
                    }
                    return callback(err);
                }

                var created = Object.assign({}, doc, { id: String(result.insertedId || doc._id) });
                callback(null, created);
            });
        } catch (e) {
            callback(e);
        }
    });
};

MongoUserRepository.prototype.list = function (callback) {
    assert.strictEqual(typeof callback, 'function');

    try {
        this.getCollection().find({ status: { $ne: 'disabled' } }).sort({ username: 1 }).toArray(function (err, docs) {
            if (err) return callback(err);
            if (!docs) return callback(null, []);

            var list = docs.map(function (doc) {
                return {
                    id: String(doc._id),
                    username: doc.username,
                    displayName: doc.displayName,
                    email: doc.email,
                    createdAt: doc.createdAt,
                    status: doc.status || 'active'
                };
            });

            callback(null, list);
        });
    } catch (e) {
        callback(e);
    }
};

MongoUserRepository.prototype.count = function (callback) {
    assert.strictEqual(typeof callback, 'function');

    try {
        this.getCollection().countDocuments({ status: { $ne: 'disabled' } }, function (err, count) {
            if (err) return callback(err);
            callback(null, count);
        });
    } catch (e) {
        callback(e);
    }
};

module.exports = MongoUserRepository;
