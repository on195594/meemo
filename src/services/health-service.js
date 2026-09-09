'use strict';

var config = require('../config.js'),
    storage = require('../storage/local-storage.js');

function ready(callback) {
    if (!config.db) return callback(new Error('Database not connected'));

    config.db.command({ ping: 1 }, function (error) {
        if (error) return callback(new Error('Database ping failed'));

        try {
            storage.checkAccess();
            callback(null);
        } catch (storageError) {
            callback(new Error('Attachment directory not accessible'));
        }
    });
}

module.exports = { ready: ready };
