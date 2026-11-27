'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var assert = require('assert');
var expect = require('expect.js');
var MongoClient = require('mongodb').MongoClient;
var config = require('../config.js');
var users = require('../users.js');
var MongoUserRepository = require('../database/users-mongo.js');

describe('MongoDB User Repository (RF-202)', function () {
    var dbClient;
    var previousDb;
    var mongoRepo;

    before(async function () {
        previousDb = config.db;
        dbClient = await MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        mongoRepo = new MongoUserRepository(config.db);
        await mongoRepo.ensureIndexes();
    });

    after(async function () {
        try {
            if (dbClient) {
                await config.db.collection('users').drop();
                await dbClient.close();
            }
        } finally {
            config.db = previousDb;
        }
    });

    beforeEach(async function () {
        await config.db.collection('users').deleteMany({});
    });

    describe('MongoUserRepository CRUD & constraints', function () {
        it('creates user, enforces usernameNorm unique index, and retrieves user', async function () {
            var userData = {
                username: 'MongoUser',
                displayName: 'Mongo Display',
                email: 'mongo@example.com',
                passwordHash: '$2b$10$abcdefghijklmnopqrstuu'
            };
            var created = await mongoRepo.create(userData);
            expect(created.username).to.equal('MongoUser');
            expect(created.id).to.be.ok();

            // Retrieve by username (case-insensitive)
            var found = await mongoRepo.getByUsername('mongouser');
            expect(found).to.be.ok();
            expect(found.username).to.equal('MongoUser');
            expect(found.email).to.equal('mongo@example.com');
            expect(found.passwordHash).to.equal('$2b$10$abcdefghijklmnopqrstuu');

            // Retrieve by id
            var byId = await mongoRepo.get(found.id);
            expect(byId).to.be.ok();
            expect(byId.username).to.equal('MongoUser');

            // Verify duplicate username rejection
            var duplicate = {
                username: 'mongouser', // Different case, same normalization
                displayName: 'Another',
                email: 'another@example.com',
                passwordHash: 'hash'
            };
            await assert.rejects(mongoRepo.create(duplicate), { message: 'user exists' });
        });

        it('rejects conflicting non-unique usernameNorm index instead of allowing duplicate accounts', async function () {
            var col = config.db.collection('users');
            await col.dropIndexes();
            await col.createIndex({ usernameNorm: 1 });
            var unverifiedRepo = new MongoUserRepository(config.db);
            try {
                await assert.rejects(unverifiedRepo.ensureIndexes());
                await assert.rejects(unverifiedRepo.create({
                    username: 'conflict_user',
                    displayName: 'Conflict',
                    email: 'c@example.com',
                    passwordHash: 'h'
                }));
            } finally {
                await col.dropIndex('usernameNorm_1').catch(function () {});
                await mongoRepo.ensureIndexes();
            }
        });

        it('lists active users and counts correctly', async function () {
            await mongoRepo.create({
                username: 'user1',
                displayName: 'User 1',
                email: 'u1@example.com',
                passwordHash: 'h1'
            });
            await mongoRepo.create({
                username: 'user2',
                displayName: 'User 2',
                email: 'u2@example.com',
                passwordHash: 'h2'
            });
            var count = await mongoRepo.count();
            expect(count).to.equal(2);
            var list = await mongoRepo.list();
            expect(list.length).to.equal(2);
            var names = list.map(function (u) { return u.username; });
            expect(names).to.contain('user1');
            expect(names).to.contain('user2');
        });
    });

    describe('create', function () {
        it('succeeds with a new user', async function () {
            await users.create('test', 'test@test.com', 'Test User', 'password');
        });

        it('fails with an existing user', async function () {
            await users.create('test', 'test@test.com', 'Test User', 'password');
            await assert.rejects(
                users.create('test', 'test@test.com', 'Test User', 'password'),
                { code: 'user exists' }
            );
        });
    });

    describe('verify', function () {
        it('succeeds with a valid password', async function () {
            await users.create('test', 'test@test.com', 'Test User', 'password');
            await users.verify('test', 'password');
        });

        it('fails with an invalid password', async function () {
            await users.create('test', 'test@test.com', 'Test User', 'password');
            await assert.rejects(users.verify('test', 'wrongpassword'), { code: 'not authorized' });
        });

        it('fails with a non-existent user', async function () {
            await assert.rejects(users.verify('idontexist', 'wrongpassword'), { code: 'not found' });
        });
    });
});
