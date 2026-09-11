'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    request = require('supertest'),
    createApp = require('../../app.js').createApp,
    logger = require('../http/middleware/logger.js');

describe('Structured Logging & Request Context (RF-401)', function () {
    it('generates a unique requestId and sets X-Request-Id header', function (done) {
        var logs = [];
        var customLogger = logger.createLogger({
            forceEnable: true,
            stream: function (record) { logs.push(record); }
        });

        var app = createApp({
            sessionMemory: true,
            sessionSecret: 'rf-401-secret',
            logger: customLogger
        });

        request(app)
            .get('/api/health/live')
            .expect(200)
            .end(function (err, res) {
                expect(err).to.be(null);
                var requestId = res.headers['x-request-id'];
                expect(requestId).to.be.a('string');
                expect(requestId.length).to.be.greaterThan(8);

                // Wait tick for finish event
                setTimeout(function () {
                    expect(logs.length).to.be.greaterThan(0);
                    var entry = logs[logs.length - 1];
                    expect(entry.requestId).to.equal(requestId);
                    expect(entry.method).to.equal('GET');
                    expect(entry.path).to.equal('/api/health/live');
                    expect(entry.status).to.equal(200);
                    expect(entry.durationMs).to.be.a('number');
                    expect(entry.level).to.equal('info');
                    expect(entry.timestamp).to.be.a('string');
                    done();
                }, 10);
            });
    });

    it('omits query strings and sensitive values from request logs', function (done) {
        var logs = [];
        var consoleLogs = [];
        var previousDebug = process.env.DEBUG;
        var previousConsoleLog = console.log;
        process.env.DEBUG = '1';
        console.log = function (message) { consoleLogs.push(String(message)); };

        function finish(err) {
            if (previousDebug === undefined) delete process.env.DEBUG;
            else process.env.DEBUG = previousDebug;
            console.log = previousConsoleLog;
            done(err);
        }

        var customLogger = logger.createLogger({
            forceEnable: true,
            stream: function (record) { logs.push(record); }
        });

        var app = createApp({
            sessionMemory: true,
            sessionSecret: 'rf-401-secret',
            logger: customLogger
        });

        request(app)
            .get('/api/health/live?token=secret&password=secret&filter=private-note&email=user@example.com')
            .set('X-Request-Id', 'rf-714-request')
            .expect(200)
            .end(function (err) {
                if (err) return finish(err);

                setTimeout(function () {
                    try {
                        expect(logs.length).to.be.greaterThan(0);
                        var entry = logs[logs.length - 1];
                        var serializedLogs = JSON.stringify(logs.concat(consoleLogs));
                        var sensitiveValues = ['secret', 'private-note', 'user@example.com'];

                        expect(entry.path).to.equal('/api/health/live');
                        expect(entry.requestId).to.equal('rf-714-request');
                        sensitiveValues.forEach(function (value) {
                            expect(serializedLogs.indexOf(value)).to.equal(-1);
                        });
                        finish();
                    } catch (assertionError) {
                        finish(assertionError);
                    }
                }, 10);
            });
    });

    it('preserves existing client-provided X-Request-Id header', function (done) {
        var logs = [];
        var customLogger = logger.createLogger({
            forceEnable: true,
            stream: function (record) { logs.push(record); }
        });

        var app = createApp({
            sessionMemory: true,
            sessionSecret: 'rf-401-secret',
            logger: customLogger
        });

        var customId = 'client-req-uuid-12345';
        request(app)
            .get('/api/health/live')
            .set('X-Request-Id', customId)
            .expect(200)
            .end(function (err, res) {
                expect(err).to.be(null);
                expect(res.headers['x-request-id']).to.equal(customId);

                setTimeout(function () {
                    expect(logs.length).to.be.greaterThan(0);
                    var entry = logs[logs.length - 1];
                    expect(entry.requestId).to.equal(customId);
                    done();
                }, 10);
            });
    });

    it('records warning level and errorCode for client errors (e.g. 400)', function (done) {
        var logs = [];
        var customLogger = logger.createLogger({
            forceEnable: true,
            stream: function (record) { logs.push(record); }
        });

        var app = createApp({
            sessionMemory: true,
            sessionSecret: 'rf-401-secret',
            logger: customLogger
        });

        request(app)
            .post('/api/login')
            .send({})
            .expect(400)
            .end(function (err) {
                expect(err).to.be(null);

                setTimeout(function () {
                    expect(logs.length).to.be.greaterThan(0);
                    var entry = logs[logs.length - 1];
                    expect(entry.status).to.equal(400);
                    expect(entry.level).to.equal('warn');
                    expect(entry.errorCode).to.equal('invalid_request');
                    done();
                }, 10);
            });
    });

    it('strictly redacts sensitive keys in sanitizeObject', function () {
        var sensitiveData = {
            username: 'alice',
            password: 'SuperSecretPassword123',
            passwordHash: '$2b$10$xyz',
            token: 'my-jwt-token',
            secret: 'session-secret-key',
            nested: {
                cookie: 'session=123',
                authorization: 'Bearer abc',
                safeInfo: 'allowed'
            }
        };

        var sanitized = logger.sanitizeObject(sensitiveData);
        expect(sanitized.username).to.equal('alice');
        expect(sanitized.password).to.equal('[REDACTED]');
        expect(sanitized.passwordHash).to.equal('[REDACTED]');
        expect(sanitized.token).to.equal('[REDACTED]');
        expect(sanitized.secret).to.equal('[REDACTED]');
        expect(sanitized.nested.cookie).to.equal('[REDACTED]');
        expect(sanitized.nested.authorization).to.equal('[REDACTED]');
        expect(sanitized.nested.safeInfo).to.equal('allowed');
    });

    it('logs structured error for internal 500 server errors', function () {
        var logs = [];
        var customLogger = logger.createLogger({
            forceEnable: true,
            stream: function (record) { logs.push(record); }
        });

        var mockReq = { id: 'test-500-req-id' };
        var testErr = new Error('Database connection failed');
        testErr.code = 'db_error';

        customLogger.logError(testErr, mockReq);

        expect(logs.length).to.equal(1);
        expect(logs[0].level).to.equal('error');
        expect(logs[0].requestId).to.equal('test-500-req-id');
        expect(logs[0].error.message).to.equal('Database connection failed');
        expect(logs[0].error.code).to.equal('db_error');
    });
});
