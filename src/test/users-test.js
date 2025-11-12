'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js'),
    config = require('../config.js'),
    users = require('../users.js');

describe('Users', function () {
    function setup(done) {
        config._clearDatabase(done);
    }

    function cleanup(done) {
        config._clearDatabase(done);
    }

    describe('create', function () {
        before(setup);
        after(cleanup);

        it('succeeds with a new user', function (done) {
            users.create('test', 'test@test.com', 'Test User', 'password', function (error) {
                expect(error).to.be(null);
                done();
            });
        });

        it('fails with an existing user', function (done) {
            users.create('test', 'test@test.com', 'Test User', 'password', function (error) {
                expect(error).to.not.be(null);
                expect(error.code).to.be('user exists');
                done();
            });
        });
    });

    describe('verify', function () {
        before(setup);
        after(cleanup);

        it('succeeds with a valid password', function (done) {
            users.create('test', 'test@test.com', 'Test User', 'password', function (error) {
                expect(error).to.be(null);
                users.verify('test', 'password', function (error) {
                    expect(error).to.be(null);
                    done();
                });
            });
        });

        it('fails with an invalid password', function (done) {
            users.create('test', 'test@test.com', 'Test User', 'password', function (error) {
                expect(error).to.be(null);
                users.verify('test', 'wrongpassword', function (error) {
                    expect(error).to.not.be(null);
                    expect(error.code).to.be('not authorized');
                    done();
                });
            });
        });

        it('fails with a non-existent user', function (done) {
            users.verify('nonexistent', 'password', function (error) {
                expect(error).to.not.be(null);
                expect(error.code).to.be('not found');
                done();
            });
        });
    });
});
