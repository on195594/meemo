/* jslint node:true */

'use strict';

exports = module.exports = {
    get: get,
    del: del,
    update: update
};

var assert = require('assert'),
    ObjectId = require('mongodb').ObjectID,
    config = require('../config.js'),
    users = require('../users.js');

var g_collections = {};

function getAlternateUserId(userId, callback) {
    if (!users || typeof users.resolveUser !== 'function') return callback(null, null);
    users.resolveUser(userId, function (err, user) {
        if (err || !user) return callback(null, null);
        if (user.id === userId && user.username && user.username !== userId) {
            return callback(null, user.username);
        }
        if (user.username === userId && user.id && user.id !== userId) {
            return callback(null, user.id);
        }
        return callback(null, null);
    });
}

function getCollection(userId) {
    assert.strictEqual(typeof userId, 'string');

    if (!g_collections[userId]) {
        config.db.createCollection(userId + '_tags', function (error) { if (error && error.codeName !== 'NamespaceExists') console.error(error); });
        g_collections[userId] = config.db.collection(userId + '_tags');
    }

    return g_collections[userId];
}

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    getCollection(userId).find({}).sort({ createdAt: -1 }).toArray(function (error, result) {
        if (error) return callback(error);
        if (!result || result.length === 0) {
            return getAlternateUserId(userId, function (altErr, altUserId) {
                if (altErr || !altUserId) return callback(null, result || []);

                getCollection(altUserId).find({}).sort({ createdAt: -1 }).toArray(function (err2, result2) {
                    if (err2) return callback(err2);
                    callback(null, result2 || []);
                });
            });
        }
        callback(null, result || []);
    });
}

function update(userId, name, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof name, 'string');
    assert.strictEqual(typeof callback, 'function');

    getCollection(userId).updateOne({ name: name }, {
        $inc: { usage: 1 },
        $set: {
            name: name,
            ownerId: userId
        }
    }, { upsert:true }, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}

function del(userId, tagId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof tagId, 'string');
    assert.strictEqual(typeof callback, 'function');

    getCollection(userId).deleteOne({ _id: new ObjectId(tagId) }, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}
