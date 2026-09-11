/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    nodeify = require('./promise.js');

function clearDatabase(callback) {
    var client;
    var promise = MongoClient.connect(module.exports.databaseUrl).then(function (connected) {
        client = connected;
        return client.db().dropDatabase();
    }).finally(function () {
        if (client) return client.close();
    });
    return nodeify(promise, callback);
}

module.exports = {
    db: null,
    databaseUrl: process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/meemo',
    _clearDatabase: clearDatabase,
    attachmentDir: process.env.ATTACHMENT_DIR || (__dirname + '/../storage')
};
