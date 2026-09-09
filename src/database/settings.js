/* jslint node:true */

'use strict';

exports = module.exports = {
    get: get,
    put: put
};

var assert = require('assert'),
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
        config.db.createCollection(userId + '_settings', function (error) { if (error && error.codeName !== 'NamespaceExists') console.error(error); });
        g_collections[userId] = config.db.collection(userId + '_settings');
    }

    return g_collections[userId];
}

function put(userId, settings, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof settings, 'object');
    assert.strictEqual(typeof callback, 'function');

    getCollection(userId).updateOne({ type: 'frontend' }, { $set: { type: 'frontend', value: settings, ownerId: userId }}, { upsert: true }, function (error) {
        if (error) return callback(error);
        callback(null);
    });
}

function get(userId, callback) {
    assert.strictEqual(typeof userId, 'string');
    assert.strictEqual(typeof callback, 'function');

    getCollection(userId).find({ type: 'frontend' }).toArray(function (error, result) {
        if (error) return callback(error);
        if (!result || result.length === 0) {
            return getAlternateUserId(userId, function (altErr, altUserId) {
                if (altErr || !altUserId) {
                    return callback(null, { title: 'Meemo' });
                }

                getCollection(altUserId).find({ type: 'frontend' }).toArray(function (err2, result2) {
                    if (err2) return callback(err2);
                    callback(null, (result2 && result2[0] && typeof result2[0].value === 'object') ? result2[0].value : {
                        title: 'Meemo'
                    });
                });
            });
        }
        callback(null, (result[0] && typeof result[0].value === 'object') ? result[0].value : {
            title: 'Meemo'
        });
    });
}
