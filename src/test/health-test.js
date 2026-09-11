'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js'),
    request = require('supertest'),
    config = require('../config.js'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp;

describe('Health & Runtime Contract', function () {
    var app;

    before(function (done) {
        config._clearDatabase(function (err) {
            if (err) return done(err);

            // Connect config.db for tests
            require('mongodb').MongoClient.connect(config.databaseUrl).then(function (client) {
                config.db = client.db();
                app = createApp({ sessionMemory: true });
                done();
            }, done);
        });
    });

    after(function (done) {
        config._clearDatabase(done);
    });

    describe('createApp', function () {
        it('throws error when in production mode without SESSION_SECRET', function () {
            expect(function () {
                createApp({ isProduction: true, sessionSecret: '' });
            }).to.throwError(function (e) {
                expect(e.message).to.contain('SESSION_SECRET is required when NODE_ENV=production');
            });
        });

        it('succeeds when in production mode with SESSION_SECRET', function () {
            var prodApp = createApp({ isProduction: true, sessionSecret: 'secret123456789012345678901234567890', sessionMemory: true });
            expect(prodApp).to.be.ok();
        });
    });

    describe('GET /api/health/live', function () {
        it('returns 200 ok', function (done) {
            request(app)
                .get('/api/health/live')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.status).to.be('ok');
                    done();
                });
        });
    });

    describe('GET /api/healthcheck (legacy)', function () {
        it('returns 200 and sets X-Deprecated header', function (done) {
            request(app)
                .get('/api/healthcheck')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers['x-deprecated']).to.contain('deprecated');
                    done();
                });
        });
    });

    describe('GET /api/health/ready', function () {
        it('returns 200 ready when db and storage are available', function (done) {
            request(app)
                .get('/api/health/ready')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.status).to.be('ready');
                    done();
                });
        });

        it('returns 503 when db is not connected', function (done) {
            var originalDb = config.db;
            config.db = null;

            request(app)
                .get('/api/health/ready')
                .expect(503)
                .end(function (err, res) {
                    config.db = originalDb;
                    expect(err).to.be(null);
                    expect(res.status).to.be(503);
                    done();
                });
        });
    });
});
