'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global beforeEach:false */

var expect = require('expect.js'),
    request = require('supertest'),
    config = require('../config.js'),
    users = require('../users.js'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp;

describe('Authentication & Registration Policy (RF-101)', function () {
    var app;
    var dbClient;
    var previousDb;

    async function resetUsers() {
        if (config.db) await config.db.collection('users').deleteMany({});
    }

    before(async function () {
        previousDb = config.db;
        process.env.REGISTRATION_MODE = 'open';

        await config._clearDatabase();
        dbClient = await require('mongodb').MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        app = createApp({ sessionMemory: true });
    });

    after(async function () {
        try {
            delete process.env.REGISTRATION_MODE;
            await config._clearDatabase();
        } finally {
            config.db = previousDb;
            if (dbClient) await dbClient.close();
        }
    });

    describe('POST /api/register validation', function () {
        beforeEach(async function () {
            process.env.REGISTRATION_MODE = 'open';
            await resetUsers();
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
        beforeEach(async function () {
            await resetUsers();
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

        describe('atomic first-user registration (RF-715)', function () {
            beforeEach(async function () {
                process.env.REGISTRATION_MODE = 'first-user';
                await Promise.all([
                    config.db.collection('users').deleteMany({}),
                    config.db.collection('system_config').deleteMany({})
                ]);
            });

            afterEach(async function () {
                await Promise.all([
                    config.db.collection('users').deleteMany({}),
                    config.db.collection('system_config').deleteMany({})
                ]);
                process.env.REGISTRATION_MODE = 'open';
                resetUsers();
            });

            it('allows exactly one of 20 concurrent first-user registrations', async function () {
                var responses = await Promise.all(Array.from({ length: 20 }, function (unused, index) {
                    return request(app)
                        .post('/api/register')
                        .send({
                            username: 'concurrent' + index,
                            password: 'password123',
                            email: 'concurrent' + index + '@example.com',
                            displayName: 'Concurrent User ' + index
                        });
                }));
                var statuses = responses.map(function (response) { return response.status; });

                expect(statuses.filter(function (status) { return status === 201; }).length).to.equal(1);
                expect(statuses.filter(function (status) { return status === 403; }).length).to.equal(19);
                expect(await users.count()).to.equal(1);
            });

            it('closes registration when an existing database has no claim record', async function () {
                await config.db.collection('users').insertOne({
                    username: 'existinguser',
                    usernameNorm: 'existinguser',
                    displayName: 'Existing User',
                    email: 'existing@example.com',
                    passwordHash: 'unused',
                    createdAt: Date.now(),
                    status: 'active'
                });

                await request(app)
                    .post('/api/register')
                    .send({
                        username: 'newuser',
                        password: 'password123',
                        email: 'new@example.com',
                        displayName: 'New User'
                    })
                    .expect(403);

                expect(await users.count()).to.equal(1);
                expect(await config.db.collection('system_config').countDocuments({
                    _id: 'registration-initialized'
                })).to.equal(1);
            });

            it('releases the claim when user creation fails', async function () {
                await config.db.collection('users').insertOne({
                    username: 'disableduser',
                    usernameNorm: 'disableduser',
                    displayName: 'Disabled User',
                    email: 'disabled@example.com',
                    passwordHash: 'unused',
                    createdAt: Date.now(),
                    status: 'disabled'
                });

                await request(app)
                    .post('/api/register')
                    .send({
                        username: 'disableduser',
                        password: 'password123',
                        email: 'replacement@example.com',
                        displayName: 'Replacement User'
                    })
                    .expect(409);

                expect(await config.db.collection('system_config').countDocuments({
                    _id: 'registration-initialized'
                })).to.equal(0);

                await request(app)
                    .post('/api/register')
                    .send({
                        username: 'recoveryuser',
                        password: 'password123',
                        email: 'recovery@example.com',
                        displayName: 'Recovery User'
                    })
                    .expect(201);
                expect(await users.count()).to.equal(1);
            });

            it('releases the claim when user creation fails', async function () {
                var failingRepo = {
                    create: function () { return Promise.reject(new Error('simulated write failure')); },
                    getByUsername: function () { return Promise.resolve(null); },
                    count: function () { return Promise.resolve(0); }
                };
                var prevRepo = users.getRepository();
                users.setRepository(failingRepo);

                try {
                    await request(app)
                        .post('/api/register')
                        .send({
                            username: 'faileduser',
                            password: 'password123',
                            email: 'failed@example.com',
                            displayName: 'Failed User'
                        })
                        .expect(500);

                    expect(await config.db.collection('system_config').countDocuments({
                        _id: 'registration-initialized'
                    })).to.equal(0);
                } finally {
                    users.setRepository(prevRepo);
                }

                await resetUsers();
                await request(app)
                    .post('/api/register')
                    .send({
                        username: 'recovereduser',
                        password: 'password123',
                        email: 'recovered@example.com',
                        displayName: 'Recovered User'
                    })
                    .expect(201);
                expect(await users.count()).to.equal(1);
            });
        });
    });

    describe('MongoDB sessions and production cookies', function () {
        var stores;

        function createMongoApp(options) {
            var MongoStore = require('connect-mongo');
            var originalCreate = MongoStore.create;
            // Capture the real stores created by createSession so each client can be closed.
            MongoStore.create = function (storeOptions) {
                var store = originalCreate.call(MongoStore, storeOptions);
                stores.push(store);
                return store;
            };
            try {
                return createApp(Object.assign({
                    databaseUrl: config.databaseUrl,
                    sessionSecret: 'mongo-session-test-secret'
                }, options));
            } finally {
                MongoStore.create = originalCreate;
            }
        }

        beforeEach(function () {
            stores = [];
        });

        afterEach(async function () {
            await Promise.all(stores.map(function (store) { return store.close(); }));
        });

        it('persists a login across independent application instances', async function () {
            var previousMode = process.env.REGISTRATION_MODE;
            try {
                process.env.REGISTRATION_MODE = 'open';
                var app1 = createMongoApp({ isProduction: false });
                await request(app1).post('/api/register').send({
                    username: 'persistentuser', password: 'password123',
                    email: 'persistent@example.com', displayName: 'Persistent User'
                }).expect(201);
                var login = await request(app1).post('/api/login')
                    .send({ username: 'persistentuser', password: 'password123' }).expect(200);
                var cookie = login.headers['set-cookie'].find(function (value) {
                    return value.startsWith('connect.sid=');
                });
                expect(cookie).to.be.ok();
                await stores[0].close();
                stores.shift();

                var app2 = createMongoApp({ isProduction: false });
                var profile = await request(app2).get('/api/profile')
                    .set('Cookie', cookie.split(';')[0]).expect(200);
                expect(profile.body.user.username).to.equal('persistentuser');
                expect(profile.body.user.email).to.equal('persistent@example.com');
            } finally {
                if (previousMode === undefined) delete process.env.REGISTRATION_MODE;
                else process.env.REGISTRATION_MODE = previousMode;
            }
        });

        it('sets Secure only for an HTTPS production origin', async function () {
            var previousOrigin = process.env.APP_ORIGIN;
            try {
                await users.create('cookieuser', 'cookie@example.com', 'Cookie User', 'password123');
                process.env.APP_ORIGIN = 'https://notes.example.com';
                var httpsApp = createMongoApp({ isProduction: true, authUserSource: 'mongo' });
                httpsApp.set('trust proxy', 'loopback');
                var secure = await request(httpsApp).post('/api/login')
                    .set('X-Forwarded-Proto', 'https')
                    .send({ username: 'cookieuser', password: 'password123' }).expect(200);
                var secureCookie = secure.headers['set-cookie'].find(function (value) {
                    return value.startsWith('connect.sid=');
                });
                expect(secureCookie).to.be.ok();
                expect(/; Secure(?:;|$)/.test(secureCookie)).to.be(true);

                process.env.APP_ORIGIN = 'http://notes.example.com';
                var httpApp = createMongoApp({ isProduction: true, authUserSource: 'mongo' });
                var insecure = await request(httpApp).post('/api/login')
                    .send({ username: 'cookieuser', password: 'password123' }).expect(200);
                var insecureCookie = insecure.headers['set-cookie'].find(function (value) {
                    return value.startsWith('connect.sid=');
                });
                expect(insecureCookie).to.be.ok();
                expect(/; Secure(?:;|$)/.test(insecureCookie)).to.be(false);
            } finally {
                if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
                else process.env.APP_ORIGIN = previousOrigin;
            }
        });
    });

    describe('POST /api/login & session hardening (RF-102)', function () {
        beforeEach(async function () {
            delete process.env.LOGIN_RATE_LIMIT_MAX;
            delete process.env.LOGIN_RATE_LIMIT_WINDOW_MS;
            await resetUsers();
            await request(app)
                .post('/api/register')
                .send({
                    username: 'validuser',
                    password: 'password123',
                    email: 'user@example.com',
                    displayName: 'Valid User'
                })
                .expect(201);
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

        it('regenerates session and sets cookie on successful login', async function () {
            var agent = request.agent(app);
            var first = await agent.post('/api/login')
                .send({ username: 'validuser', password: 'password123' })
                .expect(200);
            expect(first.body.user).to.be.an('object');
            expect(first.body.user.username).to.equal('validuser');
            var firstCookie = first.headers['set-cookie'].find(function (cookie) {
                return cookie.startsWith('connect.sid=');
            });
            expect(firstCookie).to.be.ok();

            var second = await agent.post('/api/login')
                .send({ username: 'validuser', password: 'password123' })
                .expect(200);
            var secondCookie = second.headers['set-cookie'].find(function (cookie) {
                return cookie.startsWith('connect.sid=');
            });
            expect(secondCookie).to.be.ok();
            expect(secondCookie.split(';')[0]).not.to.equal(firstCookie.split(';')[0]);

            var profile = await agent.get('/api/profile').expect(200);
            expect(profile.body.user.username).to.equal('validuser');
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
