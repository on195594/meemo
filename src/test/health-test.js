'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js'),
    request = require('supertest'),
    config = require('../config.js'),
    health = require('../services/health-service.js'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp,
    startServer = appModule.startServer;

describe('Health & Runtime Contract', function () {
    var app;
    var dbClient;
    var previousDb;

    before(async function () {
        previousDb = config.db;
        await config._clearDatabase();
        dbClient = await require('mongodb').MongoClient.connect(config.databaseUrl);
        config.db = dbClient.db();
        app = createApp({ sessionMemory: true });
    });

    after(async function () {
        try {
            await config._clearDatabase();
        } finally {
            config.db = previousDb;
            if (dbClient) await dbClient.close();
        }
    });

    describe('createApp and production hardening', function () {
        it('succeeds when in production mode with SESSION_SECRET', function () {
            var prodApp = createApp({ isProduction: true, sessionSecret: 'secret123456789012345678901234567890', sessionMemory: true });
            expect(prodApp).to.be.ok();
        });

        it('throws immediately in createApp and startServer when NODE_ENV=production and SESSION_SECRET is missing', async function () {
            expect(function () {
                createApp({ isProduction: true, sessionSecret: '' });
            }).to.throwError(/FATAL: SESSION_SECRET is required/);

            var threw = false;
            try {
                await startServer({ isProduction: true, sessionSecret: '' });
            } catch (err) {
                threw = true;
                expect(err.message).to.contain('FATAL: SESSION_SECRET is required');
            }
            expect(threw).to.be(true);
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

        it('reports bounded process memory fields for health responses', function () {
            var stats = health.processStats();
            expect(stats.uptimeSeconds).to.be.a('number');
            expect(stats.memory.rssBytes).to.be.a('number');
            expect(stats.memory.heapUsedBytes).to.be.a('number');
            expect(stats.memory.heapTotalBytes).to.be.a('number');
            expect(stats.memory.externalBytes).to.be.a('number');
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
                    expect(res.body.code).to.equal('service_unavailable');
                    expect(res.body.message).to.contain('Database not connected');
                    done();
                });
        });
    });
});
