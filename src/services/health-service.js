'use strict';

var config = require('../config.js'),
    nodeify = require('../promise.js'),
    storage = require('../storage/local-storage.js');

function ready(callback) {
    var promise = Promise.resolve().then(async function () {
        if (!config.db) throw new Error('Database not connected');
        try {
            await config.db.command({ ping: 1 });
        } catch (error) {
            throw new Error('Database ping failed');
        }
        try {
            await storage.checkAccess();
        } catch (error) {
            throw new Error('Attachment directory not accessible');
        }
    });
    return nodeify(promise, callback);
}

module.exports = {
    ready: ready
};
