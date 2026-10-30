'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */
/* global afterEach:false */

var expect = require('expect.js');
var fs = require('fs');
var path = require('path');
var request = require('supertest');
var MongoClient = require('mongodb').MongoClient;
var config = require('../config.js');
var users = require('../users.js');
var MongoUserRepository = require('../database/users-mongo.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('MongoDB User Repository (RF-202)', function () {
    var dbClient;
    var mongoRepo;

    before(async function () {
        dbClient = await MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        mongoRepo = new MongoUserRepository(config.db);
        await mongoRepo.ensureIndexes();
    });

    after(async function () {
        if (dbClient) {
            await config.db.collection('users').drop();
            await dbClient.close();
        }
    });

    beforeEach(async function () {
        await config.db.collection('users').deleteMany({});
    });

    describe('MongoUserRepository CRUD & constraints', function () {
        it('creates user, enforces usernameNorm unique index, and retrieves user', function (done) {
            var userData = {
                username: 'MongoUser',
                displayName: 'Mongo Display',
                email: 'mongo@example.com',
                passwordHash: '$2b$10$abcdefghijklmnopqrstuu'
            };

            mongoRepo.create(userData, function (err, created) {
                if (err) return done(err);
                expect(created.username).to.equal('MongoUser');
                expect(created.id).to.be.ok();

                // Retrieve by username (case-insensitive)
                mongoRepo.getByUsername('mongouser', function (err, found) {
                    if (err) return done(err);
                    expect(found).to.be.ok();
                    expect(found.username).to.equal('MongoUser');
                    expect(found.email).to.equal('mongo@example.com');
                    expect(found.passwordHash).to.equal('$2b$10$abcdefghijklmnopqrstuu');

                    // Retrieve by id
                    mongoRepo.get(found.id, function (err, byId) {
                        if (err) return done(err);
                        expect(byId).to.be.ok();
                        expect(byId.username).to.equal('MongoUser');

                        // Verify duplicate username rejection
                        var duplicate = {
                            username: 'mongouser', // Different case, same normalization
                            displayName: 'Another',
                            email: 'another@example.com',
                            passwordHash: 'hash'
                        };

                        mongoRepo.create(duplicate, function (err) {
                            expect(err).to.be.ok();
                            expect(err.message).to.equal('user exists');
                            done();
                        });
                    });
                });
            });
        });

        it('lists active users and counts correctly', function (done) {
            mongoRepo.create({
                username: 'user1',
                displayName: 'User 1',
                email: 'u1@example.com',
                passwordHash: 'h1'
            }, function (err) {
                if (err) return done(err);

                mongoRepo.create({
                    username: 'user2',
                    displayName: 'User 2',
                    email: 'u2@example.com',
                    passwordHash: 'h2'
                }, function (err) {
                    if (err) return done(err);

                    mongoRepo.count(function (err, count) {
                        if (err) return done(err);
                        expect(count).to.equal(2);

                        mongoRepo.list(function (err, list) {
                            if (err) return done(err);
                            expect(list.length).to.equal(2);
                            var names = list.map(function (u) { return u.username; });
                            expect(names).to.contain('user1');
                            expect(names).to.contain('user2');
                            done();
                        });
                    });
                });
            });
        });
    });

});
