/* jslint node:true */

'use strict';

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js');

function MongoUserRepository(db) {
    this._db = db || null;
    this._indexesCreated = false;
    this._indexPromise = null;
}

function isDuplicateKey(error) {
    return error.code === 11000 || (error.message && error.message.indexOf('E11000') !== -1);
}

async function hasUniqueUsernameIndex(collection) {
    if (typeof collection.indexes !== 'function') return false;
    var indexes = await collection.indexes().catch(function () { return []; });
    return indexes.some(function (idx) {
        return idx && idx.unique === true && idx.key &&
            idx.key.usernameNorm === 1 && Object.keys(idx.key).length === 1;
    });
}

MongoUserRepository.prototype.getCollection = function () {
    var collection = (this._db || config.db).collection('users');
    var self = this;

    if (!this._indexesCreated && !this._indexPromise) {
        this.ensureIndexes().catch(function (error) {
            console.error('Warning: could not create users.usernameNorm unique index:', error);
        });
    }
    return collection;
};

MongoUserRepository.prototype.ensureIndexes = async function () {
    var self = this;
    var db = self._db || config.db;
    if (!db) throw new Error('MongoDB database is not connected');
    var collection = db.collection('users');
    if (!self._indexPromise) {
        self._indexPromise = collection.createIndex({ usernameNorm: 1 }, { unique: true }).then(function () {
            self._indexesCreated = true;
        }).catch(async function (error) {
            var isConflict = error && (
                error.codeName === 'IndexOptionsConflict' ||
                error.codeName === 'IndexKeySpecsConflict' ||
                error.code === 85 ||
                error.code === 86
            );
            if (isConflict && await hasUniqueUsernameIndex(collection)) {
                self._indexesCreated = true;
                return;
            }
            self._indexesCreated = false;
            self._indexPromise = null;
            throw error;
        });
    }
    return self._indexPromise;
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

    var collection = self.getCollection();
    if (!self._indexesCreated) await self.ensureIndexes();

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

    try {
        var result = await collection.insertOne(doc);
        return Object.assign({}, doc, { id: String(result.insertedId || doc._id) });
    } catch (error) {
        if (isDuplicateKey(error)) {
            throw new Error('user exists');
        }
        throw error;
    }
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
