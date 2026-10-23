'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    users = require('../users.js'),
    userRepoModule = require('../database/user-repository.js'),
    MongoUserRepository = require('../database/users-mongo.js');

describe('User repository compatibility (retired abstract class)', function () {
    it('aliases UserRepository to MongoUserRepository for backward compatibility', function () {
        expect(users.UserRepository).to.be(MongoUserRepository);
        expect(userRepoModule).to.be(MongoUserRepository);
    });
});
