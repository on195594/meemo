'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js'),
    MongoClient = require('mongodb').MongoClient,
    config = require('../config.js'),
    users = require('../users.js');

describe('Users', function () {
    var dbClient;

    before(async function () {
        dbClient = await MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        await config._clearDatabase();
    });

    after(async function () {
        if (dbClient) {
            await config._clearDatabase();
            await dbClient.close();
        }
    });

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
        beforeEach(setup);
        afterEach(cleanup);

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
            users.verify('idontexist', 'wrongpassword', function (error) {
                expect(error).to.not.be(null);
                expect(error.code).to.be('not found');
                done();
            });
        });
    });
});
