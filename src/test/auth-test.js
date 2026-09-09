'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var expect = require('expect.js'),
    fs = require('fs'),
    request = require('supertest'),
    config = require('../config.js'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp;

describe('Authentication & Registration Policy (RF-101)', function () {
    var app;
    var usersFilePath = '/tmp/meemo-auth-test-' + process.pid + '.json';

    var prevUsersFile = process.env.USERS_FILE;

    function resetUserFile() {
        process.env.USERS_FILE = usersFilePath;
        fs.rmSync(usersFilePath, { force: true });
    }

    before(function (done) {
        process.env.USERS_FILE = usersFilePath;
        process.env.REGISTRATION_MODE = 'open';
        resetUserFile();

        config._clearDatabase(function (err) {
            if (err) return done(err);

            var MongoClient = require('mongodb').MongoClient;
            MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (err, client) {
                if (err) return done(err);
                config.db = client.db();
                app = createApp({ sessionMemory: true });
                done();
            });
        });
    });

    after(function (done) {
        process.env.USERS_FILE = prevUsersFile;
        delete process.env.REGISTRATION_MODE;
        fs.rmSync(usersFilePath, { force: true });
        config._clearDatabase(done);
    });

    describe('POST /api/register validation', function () {
        beforeEach(function () {
            process.env.REGISTRATION_MODE = 'open';
            resetUserFile();
        });

        it('rejects missing fields with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({ username: 'validuser' })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('missing username, password, email or displayName');
                    done();
                });
        });

        it('rejects username with invalid characters with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'user/name..invalid',
                    password: 'password123',
                    email: 'user@example.com',
                    displayName: 'User Name'
                })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('username must be 3-32 characters');
                    done();
                });
        });

        it('rejects username that is too short with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'ab',
                    password: 'password123',
                    email: 'user@example.com',
                    displayName: 'User Name'
                })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('username must be 3-32 characters');
                    done();
                });
        });

        it('rejects password shorter than 8 characters with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'validuser',
                    password: 'short',
                    email: 'user@example.com',
                    displayName: 'User Name'
                })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('password must be between 8 and 128 characters');
                    done();
                });
        });

        it('rejects invalid email address with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'validuser',
                    password: 'password123',
                    email: 'notanemail',
                    displayName: 'User Name'
                })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('invalid email address');
                    done();
                });
        });

        it('rejects empty displayName with 400', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'validuser',
                    password: 'password123',
                    email: 'user@example.com',
                    displayName: '   '
                })
                .expect(400)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('displayName must be between 1 and 64 characters');
                    done();
                });
        });

        it('successfully registers valid user and normalizes username to lowercase', function (done) {
            request(app)
                .post('/api/register')
                .send({
                    username: 'Alice_User-1',
                    password: 'password123',
                    email: 'alice@example.com',
                    displayName: 'Alice'
                })
                .expect(201)
                .end(function (err) {
                    expect(err).to.be(null);

                    // Duplicate registration should return 409
                    request(app)
                        .post('/api/register')
                        .send({
                            username: 'alice_user-1',
                            password: 'password123',
                            email: 'alice2@example.com',
                            displayName: 'Alice 2'
                        })
                        .expect(409)
                        .end(function (err) {
                            expect(err).to.be(null);
                            done();
                        });
                });
        });
    });

    describe('REGISTRATION_MODE policies', function () {
        beforeEach(function () {
            resetUserFile();
        });

        it('blocks registration when REGISTRATION_MODE=disabled', function (done) {
            process.env.REGISTRATION_MODE = 'disabled';

            request(app)
                .post('/api/register')
                .send({
                    username: 'userone',
                    password: 'password123',
                    email: 'one@example.com',
                    displayName: 'User One'
                })
                .expect(403)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.contain('Registration is disabled');
                    done();
                });
        });

        it('allows first user and rejects subsequent users when REGISTRATION_MODE=first-user', function (done) {
            process.env.REGISTRATION_MODE = 'first-user';

            request(app)
                .post('/api/register')
                .send({
                    username: 'firstuser',
                    password: 'password123',
                    email: 'first@example.com',
                    displayName: 'First User'
                })
                .expect(201)
                .end(function (err) {
                    expect(err).to.be(null);

                    // Second user attempt should fail with 403
                    request(app)
                        .post('/api/register')
                        .send({
                            username: 'seconduser',
                            password: 'password123',
                            email: 'second@example.com',
                            displayName: 'Second User'
                        })
                        .expect(403)
                        .end(function (err, res) {
                            expect(err).to.be(null);
                            expect(res.body.message).to.contain('Registration is closed');
                            done();
                        });
                });
        });
    });

    describe('POST /api/login & session hardening (RF-102)', function () {
        beforeEach(function (done) {
            delete process.env.LOGIN_RATE_LIMIT_MAX;
            delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
            resetUserFile();
            request(app)
                .post('/api/register')
                .send({
                    username: 'validuser',
                    password: 'password123',
                    email: 'user@example.com',
                    displayName: 'Valid User'
                })
                .expect(201, done);
        });

        it('returns 401 with unified message for nonexistent user without leaking 404', function (done) {
            request(app)
                .post('/api/login')
                .send({ username: 'nonexistent', password: 'password123' })
                .expect(401)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.equal('Invalid username or password');
                    done();
                });
        });

        it('returns 401 with unified message for incorrect password', function (done) {
            request(app)
                .post('/api/login')
                .send({ username: 'validuser', password: 'wrongpassword' })
                .expect(401)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.message).to.equal('Invalid username or password');
                    done();
                });
        });

        it('regenerates session and sets cookie on successful login', function (done) {
            var agent = request.agent(app);
            agent
                .post('/api/login')
                .send({ username: 'validuser', password: 'password123' })
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers['set-cookie']).to.be.ok();

                    // Profile can be accessed with authenticated session
                    agent
                        .get('/api/profile')
                        .expect(200)
                        .end(function (err, profileRes) {
                            expect(err).to.be(null);
                            expect(profileRes.body.user.username).to.equal('validuser');
                            done();
                        });
                });
        });

        it('limits repeated failed login attempts with 429', function (done) {
            process.env.LOGIN_RATE_LIMIT_MAX = '3';
            process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '5000';

            // Attempt 1, 2, 3 -> 401
            request(app).post('/api/login').send({ username: 'validuser', password: 'bad' }).expect(401, function () {
                request(app).post('/api/login').send({ username: 'validuser', password: 'bad' }).expect(401, function () {
                    request(app).post('/api/login').send({ username: 'validuser', password: 'bad' }).expect(401, function () {
                        // Attempt 4 -> 429
                        request(app).post('/api/login').send({ username: 'validuser', password: 'bad' }).expect(429, function (err, res) {
                            delete process.env.LOGIN_RATE_LIMIT_MAX;
                            delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
                            expect(err).to.be(null);
                            expect(res.body.message).to.contain('Too many login attempts');
                            done();
                        });
                    });
                });
            });
        });

        it('destroys session on logout', function (done) {
            var agent = request.agent(app);
            agent
                .post('/api/login')
                .send({ username: 'validuser', password: 'password123' })
                .expect(200)
                .end(function () {
                    agent
                        .post('/api/logout')
                        .expect(200)
                        .end(function () {
                            agent
                                .get('/api/profile')
                                .expect(401, done);
                        });
                });
        });
    });
});
