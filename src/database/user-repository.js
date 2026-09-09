/* jslint node:true */

'use strict';

function UserRepository() {}

UserRepository.prototype.get = function (id, callback) {
    throw new Error('Not implemented: UserRepository.get');
};

UserRepository.prototype.getByUsername = function (username, callback) {
    throw new Error('Not implemented: UserRepository.getByUsername');
};

UserRepository.prototype.create = function (userData, callback) {
    throw new Error('Not implemented: UserRepository.create');
};

UserRepository.prototype.list = function (callback) {
    throw new Error('Not implemented: UserRepository.list');
};

UserRepository.prototype.count = function (callback) {
    throw new Error('Not implemented: UserRepository.count');
};

module.exports = UserRepository;
