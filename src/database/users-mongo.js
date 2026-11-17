/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js');

function MongoUserRepository(db) {
    this._db = db || null;
    this._indexesCreated = false;
}

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

MongoUserRepository.prototype.ensureIndexes = async function () {
    var self = this;
    try {
        var db = self._db || config.db;
        if (!db) throw new Error('MongoDB database is not connected');
        await db.collection('users').createIndex({ usernameNorm: 1 }, { unique: true });
        self._indexesCreated = true;
    } catch (error) {
        if (error.codeName === 'IndexOptionsConflict') {
            self._indexesCreated = true;
            return;
        }
        throw error;
    }
};

MongoUserRepository.prototype.claimFirstUserRegistration = async function () {
    var self = this;
    try {
        var db = self._db || config.db;
        if (!db) throw new Error('MongoDB database is not connected');
        await db.collection('system_config').insertOne({ _id: 'registration-initialized' });
        return true;
    } catch (error) {
        if (isDuplicateKey(error)) return false;
        throw error;
    }
};

MongoUserRepository.prototype.releaseFirstUserRegistration = async function () {
    var self = this;
    var db = self._db || config.db;
    if (!db) throw new Error('MongoDB database is not connected');
    return db.collection('system_config').deleteOne({ _id: 'registration-initialized' });
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

MongoUserRepository.prototype.get = async function (id) {
    var self = this;
    assert.strictEqual(typeof id, 'string');

    var norm = id.toLowerCase();
    var conditions = [{ usernameNorm: norm }, { username: id }];
    if (ObjectId.isValid(id) && String(new ObjectId(id)) === id) conditions.unshift({ _id: new ObjectId(id) });

    var doc = await self.getCollection().findOne({ $or: conditions });
    return mapUser(doc, true);
};

MongoUserRepository.prototype.getByUsername = async function (username) {
    var self = this;
    assert.strictEqual(typeof username, 'string');

    var doc = await self.getCollection().findOne({ usernameNorm: username.toLowerCase() });
    return mapUser(doc, true);
};

MongoUserRepository.prototype.create = async function (userData) {
    var self = this;
    assert(userData && typeof userData === 'object');
    assert.strictEqual(typeof userData.username, 'string');

    return this.getByUsername(userData.username).then(function (existing) {
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
};

MongoUserRepository.prototype.list = async function () {
    var self = this;
    var docs = await self.getCollection().find({ status: { $ne: 'disabled' } }).sort({ username: 1 }).toArray();
    return (docs || []).map(function (doc) { return mapUser(doc, false); });
};

MongoUserRepository.prototype.count = async function () {
    var self = this;
    return self.getCollection().countDocuments({ status: { $ne: 'disabled' } });
};

module.exports = MongoUserRepository;
