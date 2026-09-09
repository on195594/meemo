/* jslint node:true */

'use strict';

var assert = require('assert'),
    util = require('util'),
    nodeify = require('../promise.js'),
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
    return nodeify(this.primary.get(id).then(function (user) {
        return user || self.fallback.get(id);
    }), callback);
};

FallbackUserRepository.prototype.getByUsername = function (username, callback) {
    var self = this;
    return nodeify(this.primary.getByUsername(username).then(function (user) {
        return user || self.fallback.getByUsername(username);
    }), callback);
};

FallbackUserRepository.prototype.create = function (userData, callback) {
    return nodeify(this.primary.create(userData), callback);
};

FallbackUserRepository.prototype.list = function (callback) {
    var self = this;
    var promise = Promise.all([this.primary.list(), this.fallback.list()]).then(function (lists) {
        var seen = {};
        return (lists[0] || []).concat(lists[1] || []).filter(function (user) {
            var norm = user.username.toLowerCase();
            if (seen[norm]) return false;
            seen[norm] = true;
            return true;
        });
    });
    return nodeify(promise, callback);
};

FallbackUserRepository.prototype.count = function (callback) {
    return nodeify(this.list().then(function (users) { return users.length; }), callback);
};

module.exports = FallbackUserRepository;
