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
var LegacyFileUserRepository = require('../database/users-file.js');
var FallbackUserRepository = require('../database/users-fallback.js');
var migrator = require('../../scripts/migrate-users-to-mongo.js');
var appModule = require('../../app.js');
var createApp = appModule.createApp;

describe('MongoDB User Repository and Migration (RF-202)', function () {
    var dbClient;
    var mongoRepo;
    var testUsersFile = '/tmp/meemo-mongo-test-' + process.pid + '.json';
    var testManifestFile = '/tmp/meemo-mongo-test-' + process.pid + '.manifest.json';
    var prevUsersFile = process.env.USERS_FILE;
    var prevAuthSource = process.env.AUTH_USER_SOURCE;

    before(async function () {
        process.env.USERS_FILE = testUsersFile;
        fs.rmSync(testUsersFile, { force: true });

        dbClient = await MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        mongoRepo = new MongoUserRepository(config.db);
        await mongoRepo.ensureIndexes();
    });

    after(async function () {
        if (prevUsersFile === undefined) delete process.env.USERS_FILE;
        else process.env.USERS_FILE = prevUsersFile;

        if (prevAuthSource === undefined) delete process.env.AUTH_USER_SOURCE;
        else process.env.AUTH_USER_SOURCE = prevAuthSource;

        users.setRepository(new LegacyFileUserRepository());
        fs.rmSync(testUsersFile, { force: true });
        fs.rmSync(testManifestFile, { force: true });

        if (dbClient) {
            await config.db.collection('users').drop();
            await dbClient.close();
        }
    });

    beforeEach(async function () {
        await config.db.collection('users').deleteMany({});
        await config.db.collection('system_migrations').deleteOne({ _id: 'users-file-to-mongo' });
        fs.rmSync(testUsersFile, { force: true });
        fs.rmSync(testManifestFile, { force: true });
    });

    function migrationOptions(usersFile) {
        var failure;
        var report;
        var identity = {
            usersFile: usersFile,
            mongoUrl: config.databaseUrl,
            manifestFile: testManifestFile
        };
        migrator.dryRun(identity, function (error, result) {
            failure = error;
            report = result;
        });
        if (failure) throw failure;
        expect(report.manifest.manifestDigest).to.be.ok();
        return identity;
    }

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

    describe('FallbackUserRepository dual-read capability', function () {
        it('reads from file when not in mongo, and gives priority to mongo when present', function (done) {
            var fileRepo = new LegacyFileUserRepository(testUsersFile);
            var fallbackRepo = new FallbackUserRepository(mongoRepo, fileRepo);

            // Create user in file repo only
            fileRepo.create({
                username: 'fileonly',
                displayName: 'File Only',
                email: 'file@example.com',
                passwordHash: 'filehash'
            }, function (err) {
                if (err) return done(err);

                // Create user in mongo repo only
                mongoRepo.create({
                    username: 'mongoonly',
                    displayName: 'Mongo Only',
                    email: 'mongo@example.com',
                    passwordHash: 'mongohash'
                }, function (err) {
                    if (err) return done(err);

                    // Dual read: find file user
                    fallbackRepo.getByUsername('fileonly', function (err, u1) {
                        if (err) return done(err);
                        expect(u1).to.be.ok();
                        expect(u1.username).to.equal('fileonly');

                        // Dual read: find mongo user
                        fallbackRepo.getByUsername('mongoonly', function (err, u2) {
                            if (err) return done(err);
                            expect(u2).to.be.ok();
                            expect(u2.username).to.equal('mongoonly');

                        // Dual list: contains both
                            fallbackRepo.list(function (err, list) {
                                if (err) return done(err);
                                expect(list.length).to.equal(2);
                                done();
                            });
                        });
                    });
                });
            });
        });
    });

    describe('Migration script (dry-run, apply, verify)', function () {
        var sourceUsers = {
            alice: {
                username: 'alice',
                displayName: 'Alice Liddell',
                email: 'alice@example.com',
                passwordHash: '$2b$10$e8w6Q01gZ2K5T1mU7A9h5u3Y9f5K3mZ7Q8'
            },
            bob: {
                username: 'bob',
                displayName: 'Bob Builder',
                email: 'bob@example.com',
                passwordHash: '$2b$10$p4r9W12hB3L6V2nV8B0j6v4Z0g6L4nZ8R9'
            }
        };

        beforeEach(function () {
            fs.writeFileSync(testUsersFile, JSON.stringify(sourceUsers, null, 4));
        });


        it('--dry-run inspects source file without writing to MongoDB', function (done) {
            migrator.dryRun({
                usersFile: testUsersFile,
                mongoUrl: config.databaseUrl,
                manifestFile: testManifestFile
            }, function (err, report) {
                if (err) return done(err);

                expect(report.success).to.be(true);
                expect(report.totalSourceUsers).to.equal(2);
                expect(report.validUsersCount).to.equal(2);
                expect(report.collisions.length).to.equal(0);

                // Ensure nothing was written to MongoDB
                mongoRepo.count(function (err, count) {
                    if (err) return done(err);
                    expect(count).to.equal(0);
                    done();
                });
            });
        });

        it('--dry-run detects normalization collisions in source file', function (done) {
            var collidedSource = {
                alice: { username: 'alice', passwordHash: 'hash1' },
                Alice: { username: 'Alice', passwordHash: 'hash2' }
            };
            var collideFile = '/tmp/meemo-collide-test-' + process.pid + '.json';
            var collideManifest = collideFile + '.manifest.json';
            fs.writeFileSync(collideFile, JSON.stringify(collidedSource, null, 4));

            migrator.dryRun({
                usersFile: collideFile,
                mongoUrl: config.databaseUrl,
                manifestFile: collideManifest
            }, function (err) {
                expect(err).to.be.ok();
                expect(err.message).to.contain('Normalization collisions detected');
                fs.rmSync(collideFile, { force: true });
                fs.rmSync(collideManifest, { force: true });
                done();
            });
        });

        it('--apply migrates users idempotently and preserves password hashes verbatim', function (done) {
            var options = migrationOptions(testUsersFile);

            migrator.apply(options, function (err, stats) {
                if (err) return done(err);

                expect(stats.migrated).to.equal(2);
                expect(stats.total).to.equal(2);

                // Verify users in MongoDB
                mongoRepo.getByUsername('alice', function (err, alice) {
                    if (err) return done(err);
                    expect(alice).to.be.ok();
                    expect(alice.email).to.equal('alice@example.com');
                    expect(alice.passwordHash).to.equal(sourceUsers.alice.passwordHash);

                    // Idempotency check: apply again
                    migrator.apply(options, function (err, stats2) {
                        if (err) return done(err);
                        expect(stats2.migrated).to.equal(0);
                        expect(stats2.replayed).to.equal(true);

                        mongoRepo.count(function (err, count) {
                            if (err) return done(err);
                            expect(count).to.equal(2); // No duplicate documents created!
                            done();
                        });
                    });
                });
            });
        });

        it('--verify confirms 100% data fidelity between source and target', function (done) {
            var options = migrationOptions(testUsersFile);

            // First apply
            migrator.apply(options, function (err) {
                if (err) return done(err);

                // Then verify
                migrator.verify(options, function (err, result) {
                    if (err) return done(err);

                    expect(result.verified).to.equal(2);
                    expect(result.total).to.equal(2);
                    expect(result.mismatches.length).to.equal(0);
                    done();
                });
            });
        });
    });

    describe('End-to-end integration with AUTH_USER_SOURCE', function () {
        it('authenticates migrated user via Express app when AUTH_USER_SOURCE=mongo', function (done) {
            // Create user with known password directly in users.json
            var bcrypt = require('bcrypt');
            bcrypt.hash('Password123!', 10, function (err, hash) {
                if (err) return done(err);

                var source = {
                    charlie: {
                        username: 'charlie',
                        displayName: 'Charlie Brown',
                        email: 'charlie@example.com',
                        passwordHash: hash
                    }
                };
                fs.writeFileSync(testUsersFile, JSON.stringify(source, null, 4));

                // Apply migration to Mongo
                migrator.apply(migrationOptions(testUsersFile), function (err) {
                    if (err) return done(err);

                    // Switch AUTH_USER_SOURCE to mongo
                    users.initRepository('mongo');

                    var app = createApp({ sessionMemory: true });
                    var agent = request.agent(app);

                    // Login with Charlie's original password against MongoDB!
                    agent
                        .post('/api/login')
                        .send({ username: 'charlie', password: 'Password123!' })
                        .expect(200)
                        .end(function (err) {
                            if (err) return done(err);

                            // Verify profile works
                            agent
                                .get('/api/profile')
                                .expect(200)
                                .end(function (err, res) {
                                    if (err) return done(err);
                                    expect(res.body.user.username).to.equal('charlie');
                                    expect(res.body.user.displayName).to.equal('Charlie Brown');
                                    done();
                                });
                        });
                });
            });
        });
    });
});
