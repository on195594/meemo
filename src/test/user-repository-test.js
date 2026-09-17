'use strict';

/* global it:false */
/* global describe:false */
/* global afterEach:false */

var expect = require('expect.js');
var util = require('util');
var nodeify = require('../promise.js');
var users = require('../users.js');
var UserRepository = require('../database/user-repository.js');

function MemoryUserRepository() {
    UserRepository.call(this);
    this._users = {};
}
util.inherits(MemoryUserRepository, UserRepository);

MemoryUserRepository.prototype.get = function (id, callback) {
    var user = this._users[id] || null;
    return nodeify(Promise.resolve(user ? Object.assign({}, user) : null), callback);
};

MemoryUserRepository.prototype.getByUsername = function (username, callback) {
    var self = this;
    var norm = username.toLowerCase();
    var foundKey = Object.keys(this._users).find(function (key) {
        return key.toLowerCase() === norm ||
            (self._users[key].username && self._users[key].username.toLowerCase() === norm);
    });
    var user = foundKey ? this._users[foundKey] : null;
    return nodeify(Promise.resolve(user ? Object.assign({}, user) : null), callback);
};

MemoryUserRepository.prototype.create = function (userData, callback) {
    var self = this;
    return nodeify(Promise.resolve().then(function () {
        var norm = userData.username.toLowerCase();
        var exists = Object.keys(self._users).some(function (k) {
            return k.toLowerCase() === norm;
        });
        if (exists) throw new Error('user exists');
        var user = Object.assign({}, userData);
        user.id = user.id || user.username;
        self._users[userData.username] = user;
        return Object.assign({}, user);
    }), callback);
};

MemoryUserRepository.prototype.list = function (callback) {
    var self = this;
    var list = Object.keys(this._users).map(function (k) {
        return Object.assign({}, self._users[k]);
    });
    return nodeify(Promise.resolve(list), callback);
};

MemoryUserRepository.prototype.count = function (callback) {
    return nodeify(Promise.resolve(Object.keys(this._users).length), callback);
};

describe('UserRepository Abstraction (RF-201)', function () {
    afterEach(function () {
        users.initRepository('mongo');
    });

    describe('UserRepository base class contract', function () {
        it('throws not implemented for abstract methods', function () {
            var baseRepo = new UserRepository();

            expect(function () { baseRepo.get('id', function () {}); }).to.throwError(/Not implemented/);
            expect(function () { baseRepo.getByUsername('user', function () {}); }).to.throwError(/Not implemented/);
            expect(function () { baseRepo.create({}, function () {}); }).to.throwError(/Not implemented/);
            expect(function () { baseRepo.list(function () {}); }).to.throwError(/Not implemented/);
            expect(function () { baseRepo.count(function () {}); }).to.throwError(/Not implemented/);
        });
    });

    describe('Custom UserRepository persistence', function () {
        it('correctly creates, retrieves, and counts users', function (done) {
            var repo = new MemoryUserRepository();

            repo.count(function (err, count) {
                if (err) return done(err);
                expect(count).to.equal(0);

                var userData = {
                    username: 'testuser',
                    displayName: 'Test User',
                    email: 'test@example.com',
                    passwordHash: 'hash123'
                };

                repo.create(userData, function (err, created) {
                    if (err) return done(err);
                    expect(created.username).to.equal('testuser');

                    repo.get('testuser', function (err, user) {
                        if (err) return done(err);
                        expect(user).to.be.ok();
                        expect(user.username).to.equal('testuser');
                        expect(user.displayName).to.equal('Test User');
                        expect(user.email).to.equal('test@example.com');
                        expect(user.passwordHash).to.equal('hash123');

                        repo.count(function (err, count2) {
                            if (err) return done(err);
                            expect(count2).to.equal(1);
                            done();
                        });
                    });
                });
            });
        });

        it('rejects duplicate username on create', function (done) {
            var repo = new MemoryUserRepository();
            var userData = {
                username: 'uniqueuser',
                displayName: 'Unique',
                email: 'unique@example.com',
                passwordHash: 'hash'
            };

            repo.create(userData, function (err) {
                if (err) return done(err);

                repo.create(userData, function (err) {
                    expect(err).to.be.ok();
                    expect(err.message).to.equal('user exists');
                    done();
                });
            });
        });

        it('supports case-insensitive username lookup in getByUsername', function (done) {
            var repo = new MemoryUserRepository();
            var userData = {
                username: 'mixedCaseUser',
                displayName: 'Mixed Case',
                email: 'mixed@example.com',
                passwordHash: 'hash'
            };

            repo.create(userData, function (err) {
                if (err) return done(err);

                repo.getByUsername('mixedcaseuser', function (err, user) {
                    if (err) return done(err);
                    expect(user).to.be.ok();
                    expect(user.username).to.equal('mixedCaseUser');
                    done();
                });
            });
        });

        it('returns empty list and null get on empty repository', function (done) {
            var repo = new MemoryUserRepository();

            repo.list(function (err, list) {
                if (err) return done(err);
                expect(list).to.be.an('array');
                expect(list.length).to.equal(0);

                repo.get('anyone', function (err, user) {
                    if (err) return done(err);
                    expect(user).to.be(null);
                    done();
                });
            });
        });
    });

    describe('User module repository swappability', function () {
        it('allows setting custom repository implementation', function (done) {
            var customRepo = new MemoryUserRepository();
            users.setRepository(customRepo);

            expect(users.getRepository()).to.equal(customRepo);

            users.create('swapped', 'swapped@example.com', 'Swapped User', 'SecretPass123!', function (err) {
                if (err) return done(err);

                users.verify('swapped', 'SecretPass123!', function (err) {
                    if (err) return done(err);

                    users.profile('swapped', false, function (err, profile) {
                        if (err) return done(err);
                        expect(profile.username).to.equal('swapped');
                        expect(profile.displayName).to.equal('Swapped User');
                        expect(profile.passwordHash).to.be(undefined);
                        done();
                    });
                });
            });
        });
    });
});
