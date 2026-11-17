'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global afterEach:false */

var expect = require('expect.js');
var http = require('http');
var MongoClient = require('mongodb').MongoClient;
var request = require('supertest');
var config = require('../config.js');
var appModule = require('../../app.js');
var lifecycle = require('../lifecycle.js');

describe('Runtime Dependency Injection and Graceful Shutdown (RF-301)', function () {
    this.timeout(20000);

    var dbClient;
    var db;

    before(async function () {
        await config._clearDatabase();
        dbClient = await MongoClient.connect(config.databaseUrl);
        db = dbClient.db();
        config.db = db;
    });

    after(async function () {
        if (dbClient) {
            await config._clearDatabase();
            await dbClient.close();
        }
    });

    describe('DatabaseManager', function () {
        it('connects with pool options and disconnects cleanly', function (done) {
            var dbManager = new lifecycle.DatabaseManager();

            dbManager.connect({
                databaseUrl: config.databaseUrl,
                maxPoolSize: 20,
                minPoolSize: 1
            }).then(function ({ db: connectedDb, client: connectedClient }) {
                expect(connectedDb).to.be.ok();
                expect(connectedClient).to.be.ok();
                expect(dbManager.isManaged).to.be(true);

                dbManager.disconnect(false).then(function () {
                    expect(dbManager.client).to.be(null);
                    done();
                }).catch(done);
            }).catch(done);
        });

        it('respects injected client/db without closing external connections', async function () {
            var dbManager = new lifecycle.DatabaseManager();

            var result = await dbManager.connect({
                client: dbClient,
                db: db
            });
            expect(result.db).to.equal(db);
            expect(result.client).to.equal(dbClient);
            expect(dbManager.isManaged).to.be(false);

            // Disconnect should NOT close the external client
            await dbManager.disconnect(false);

            // dbClient should still be open and operational
            var count = await db.collection('things').countDocuments({});
            expect(typeof count).to.equal('number');
        });
    });

    describe('ShutdownManager', function () {
        it('lets an in-flight request finish after SIGTERM', function (done) {
            this.timeout(1000);

            var events = [];
            var newConnectionRefused = false;
            var port;
            var server = http.createServer(function (req, res) {
                res.on('finish', function () { events.push('response'); });
                setTimeout(function () {
                    process.emit('SIGTERM');
                    setTimeout(function () {
                        var newRequest = http.get({ hostname: '127.0.0.1', port: port });
                        newRequest.on('error', function (error) {
                            if (error.code === 'ECONNREFUSED') newConnectionRefused = true;
                        });
                    }, 50);
                }, 30);
                setTimeout(function () { res.end('finished'); }, 150);
            });

            server.listen(0, '127.0.0.1', function () {
                port = server.address().port;
                var shutdownManager = new lifecycle.ShutdownManager({
                    server: server,
                    databaseManager: {
                        disconnect: function () {
                            events.push('mongo');
                            return Promise.resolve();
                        }
                    },
                    timeoutMs: 1000
                });
                shutdownManager.attachSignals(function (err) {
                    if (err) return done(err);
                    expect(events).to.eql(['response', 'mongo']);
                    expect(newConnectionRefused).to.be(true);
                    done();
                });

                var responseBody = '';
                var req = http.get({
                    hostname: '127.0.0.1',
                    port: port,
                    headers: { Connection: 'close' }
                }, function (res) {
                    res.on('data', function (chunk) { responseBody += chunk; });
                    res.on('end', function () { expect(responseBody).to.equal('finished'); });
                });
                req.on('error', done);
            });
        });

        it('force-closes a 30-second hanging request after the shutdown timeout', async function () {
            var events = [];
            var shutdownStarted;
            var startShutdown;
            var requestClosed;
            var closeRequest;
            var server = http.createServer(function (req, res) {
                res.write('hanging');
                var hangingTimer = setTimeout(function () { res.end(); }, 30000);
                if (hangingTimer.unref) hangingTimer.unref();
                res.on('close', function () { clearTimeout(hangingTimer); });
                setImmediate(startShutdown);
            });
            server.on('connection', function (socket) {
                var destroy = socket.destroy;
                socket.destroy = function () {
                    events.push('socket');
                    return destroy.apply(socket, arguments);
                };
            });
            var shutdownManager = new lifecycle.ShutdownManager({
                server: server,
                databaseManager: {
                    disconnect: function () {
                        events.push('mongo');
                        return Promise.resolve();
                    }
                },
                timeoutMs: 100
            });

            shutdownStarted = new Promise(function (resolve, reject) {
                startShutdown = function () { shutdownManager.shutdown('SIGTERM').then(resolve, reject); };
            });
            requestClosed = new Promise(function (resolve, reject) {
                closeRequest = function (response) {
                    response.on('aborted', resolve);
                    response.on('end', function () {
                        if (response.complete) reject(new Error('Hanging response completed normally'));
                    });
                };
            });

            await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
            var startedAt = Date.now();
            var req = http.get({
                hostname: '127.0.0.1',
                port: server.address().port
            }, closeRequest);
            req.on('error', function (error) {
                if (error.code === 'ECONNRESET') return;
                throw error;
            });

            await Promise.all([shutdownStarted, requestClosed]);
            expect(Date.now() - startedAt).to.be.greaterThan(80);
            expect(Date.now() - startedAt).to.be.lessThan(1000);
            expect(events).to.eql(['socket', 'mongo']);
        });

        it('defaults the shutdown timeout to 15 seconds', function () {
            var originalTimeout = process.env.SHUTDOWN_TIMEOUT_MS;
            delete process.env.SHUTDOWN_TIMEOUT_MS;
            try {
                expect(new lifecycle.ShutdownManager().timeoutMs).to.equal(15000);
            } finally {
                if (originalTimeout === undefined) delete process.env.SHUTDOWN_TIMEOUT_MS;
                else process.env.SHUTDOWN_TIMEOUT_MS = originalTimeout;
            }
        });

        it('returns readiness 503 during shutdown, closes Mongo, and removes signal handlers', async function () {
            var sigtermListeners = process.listenerCount('SIGTERM');
            var sigintListeners = process.listenerCount('SIGINT');
            var releaseMongo;
            var mongoClosed = false;
            var shutdownManager = new lifecycle.ShutdownManager({
                databaseManager: {
                    disconnect: function () {
                        mongoClosed = true;
                        return new Promise(function (resolve) { releaseMongo = resolve; });
                    }
                },
                timeoutMs: 500
            });
            var app = appModule.createApp({
                db: { command: function () { return Promise.resolve(); } },
                sessionMemory: true,
                sessionSecret: 'runtime-lifecycle-test-secret',
                shutdownManager: shutdownManager
            });
            var shutdownComplete = new Promise(function (resolve, reject) {
                shutdownManager.attachSignals(function (error) {
                    if (error) reject(error); else resolve();
                });
            });

            process.emit('SIGTERM');
            expect(shutdownManager.isShuttingDown).to.be(true);

            var response;
            try {
                response = await request(app).get('/api/health/ready');
            } finally {
                if (releaseMongo) releaseMongo();
                await shutdownComplete;
            }
            expect(response.status).to.equal(503);
            expect(response.body.message).to.contain('shutting down');
            expect(mongoClosed).to.be(true);
            expect(process.listenerCount('SIGTERM')).to.equal(sigtermListeners);
            expect(process.listenerCount('SIGINT')).to.equal(sigintListeners);
        });

        it('isolates shutdown readiness between app instances', async function () {
            var options = {
                db: { command: function () { return Promise.resolve(); } },
                sessionMemory: true,
                sessionSecret: 'runtime-lifecycle-test-secret'
            };
            var shuttingDownApp = appModule.createApp(Object.assign({}, options, {
                shutdownManager: { isShuttingDown: true }
            }));
            var readyApp = appModule.createApp(Object.assign({}, options, {
                shutdownManager: { isShuttingDown: false }
            }));

            var responses = await Promise.all([
                request(shuttingDownApp).get('/api/health/ready'),
                request(readyApp).get('/api/health/ready')
            ]);
            expect(responses[0].status).to.equal(503);
            expect(responses[1].status).to.equal(200);
        });

        it('shuts down HTTP server and database sequentially and idempotently', function (done) {
            var server = http.createServer(function (req, res) {
                res.writeHead(200);
                res.end('ok');
            });

            server.listen(0, '127.0.0.1', function () {
                var dbManager = new lifecycle.DatabaseManager();
                dbManager.connect({ databaseUrl: config.databaseUrl }).then(function () {

                    var shutdownManager = new lifecycle.ShutdownManager({
                        server: server,
                        databaseManager: dbManager,
                        timeoutMs: 5000
                    });

                    shutdownManager.shutdown('SIGTERM').then(function () {
                        expect(dbManager.client).to.be(null);

                        // Second call should be a no-op / idempotent
                        shutdownManager.shutdown('SIGTERM').then(function () {
                            done();
                        }).catch(done);
                    }).catch(done);
                }).catch(done);
            });
        });
    });

    describe('startServer integration & lifecycle', function () {
        var runningInstance;

        afterEach(function (done) {
            if (runningInstance) {
                var inst = runningInstance;
                runningInstance = null;
                inst.close().then(function () { done(); }, done);
            } else {
                done();
            }
        });

        it('starts server on free port and handles HTTP requests cleanly', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                autoAttachSignals: false,
                sessionMemory: true
            }).then(function (instance) {
                expect(instance).to.be.ok();
                runningInstance = instance;

                var addr = instance.server.address();
                expect(addr.port).to.be.greaterThan(0);

                var req = http.get({
                    hostname: '127.0.0.1',
                    port: addr.port,
                    path: '/api/health/live',
                    headers: { Connection: 'close' }
                }, function (res) {
                    expect(res.statusCode).to.equal(200);
                    res.resume();
                    done();
                });
                req.on('error', done);
            }).catch(done);
        });

        it('supports dependency injection of pre-existing client and db', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                client: dbClient,
                db: db,
                autoAttachSignals: false,
                sessionMemory: true
            }).then(function (instance) {
                expect(instance.client).to.equal(dbClient);
                expect(instance.db).to.equal(db);

                var addr = instance.server.address();
                var req = http.get({
                    hostname: '127.0.0.1',
                    port: addr.port,
                    path: '/api/health/live',
                    headers: { Connection: 'close' }
                }, function (res) {
                    expect(res.statusCode).to.equal(200);
                    res.resume();

                    // Closing server must not close our test dbClient
                    instance.close().then(function () {
                        db.collection('things').countDocuments({}).then(function (count) {
                            expect(typeof count).to.equal('number');
                            done();
                        }).catch(done);
                    }).catch(done);
                });
                req.on('error', done);
            }).catch(done);
        });

        it('fails gracefully and reports error when database connection fails', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                databaseUrl: 'mongodb://127.0.0.1:19999/invalid-db-test',
                serverSelectionTimeoutMS: 500,
                autoAttachSignals: false,
                sessionMemory: true
            }).then(function () {
                throw new Error('Expected operation to reject');
            }, function (err) {
                expect(err).to.be.ok();
                done();
            }).catch(done);
        });
    });
});
