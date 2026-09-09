/* jslint node:true */

'use strict';

var assert = require('assert'),
    util = require('util'),
    UserRepository = require('./user-repository.js');

function FallbackUserRepository(primaryRepo, fallbackRepo) {
    UserRepository.call(this);
    assert(primaryRepo, 'primaryRepo is required');
    assert(fallbackRepo, 'fallbackRepo is required');
    this.primary = primaryRepo;
    this.fallback = fallbackRepo;
}
util.inherits(FallbackUserRepository, UserRepository);

FallbackUserRepository.prototype.get = function (id, callback) {
    var self = this;
    this.primary.get(id, function (err, user) {
        if (err) return callback(err);
        if (user) return callback(null, user);
        self.fallback.get(id, callback);
    });
};

FallbackUserRepository.prototype.getByUsername = function (username, callback) {
    var self = this;
    this.primary.getByUsername(username, function (err, user) {
        if (err) return callback(err);
        if (user) return callback(null, user);
        self.fallback.getByUsername(username, callback);
    });
};

FallbackUserRepository.prototype.create = function (userData, callback) {
    // New users are always created in the primary repository
    this.primary.create(userData, callback);
};

FallbackUserRepository.prototype.list = function (callback) {
    var self = this;
    this.primary.list(function (err, primaryList) {
        if (err) return callback(err);
        self.fallback.list(function (err, fallbackList) {
            if (err) return callback(err);

            var seen = {};
            var combined = [];

            (primaryList || []).forEach(function (u) {
                var norm = u.username.toLowerCase();
                if (!seen[norm]) {
                    seen[norm] = true;
                    combined.push(u);
                }
            });

            (fallbackList || []).forEach(function (u) {
                var norm = u.username.toLowerCase();
                if (!seen[norm]) {
                    seen[norm] = true;
                    combined.push(u);
                }
            });

            callback(null, combined);
        });
    });
};

FallbackUserRepository.prototype.count = function (callback) {
    this.list(function (err, list) {
        if (err) return callback(err);
        callback(null, list.length);
    });
};

module.exports = FallbackUserRepository;
