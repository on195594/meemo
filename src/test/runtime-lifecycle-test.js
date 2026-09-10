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

    before(function (done) {
        config._clearDatabase(function (err) {
            if (err) return done(err);

            MongoClient.connect(config.databaseUrl, { useUnifiedTopology: true }, function (err, client) {
                if (err) return done(err);
                dbClient = client;
                db = client.db();
                config.db = db;
                done();
            });
        });
    });

    after(function (done) {
        if (dbClient) {
            config._clearDatabase(function () {
                dbClient.close(done);
            });
        } else {
            done();
        }
    });

    describe('WorkerManager', function () {
        it('registers, runs once, and reports running state', function (done) {
            var workerManager = new lifecycle.WorkerManager();
            var runCount = 0;

            workerManager.register('testTask', function (next) {
                runCount++;
                next(null);
            }, 50);

            expect(workerManager.isRunning()).to.be(false);

            workerManager.runOnce('testTask', function (err) {
                if (err) return done(err);
                expect(runCount).to.equal(1);

                workerManager.start();
                expect(workerManager.isRunning()).to.be(true);

                setTimeout(function () {
                    workerManager.stop();
                    expect(workerManager.isRunning()).to.be(false);
                    var countAfterStop = runCount;
                    expect(countAfterStop).to.be.greaterThan(1);

                    setTimeout(function () {
                        // Assert that stopping prevented additional executions
                        expect(runCount).to.equal(countAfterStop);
                        done();
                    }, 100);
                }, 120);
            });
        });

        it('does not overlap executions of the same worker', async function () {
            this.timeout(2000);

            var workerManager = new lifecycle.WorkerManager();
            var concurrentExecutions = 0;
            var maxConcurrentExecutions = 0;
            var runCount = 0;

            workerManager.register('slowTask', function () {
                concurrentExecutions++;
                maxConcurrentExecutions = Math.max(maxConcurrentExecutions, concurrentExecutions);
                runCount++;
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        concurrentExecutions--;
                        resolve();
                    }, 200);
                });
            }, 50);

            workerManager.start();
            await new Promise(function (resolve) { setTimeout(resolve, 500); });
            await workerManager.stop();

            expect(runCount).to.be.greaterThan(1);
            expect(maxConcurrentExecutions).to.equal(1);
        });

        it('releases worker state after an error', function (done) {
            var workerManager = new lifecycle.WorkerManager();
            var attempts = 0;

            workerManager.register('failingTask', function (next) {
                attempts++;
                next(attempts === 1 ? new Error('Simulated worker failure') : null);
            });

            workerManager.runOnce('failingTask', function (err) {
                expect(err).to.be.ok();
                expect(err.message).to.equal('Simulated worker failure');
                workerManager.runOnce('failingTask', function (secondError) {
                    if (secondError) return done(secondError);
                    expect(attempts).to.equal(2);
                    done();
                });
            });
        });

        it('does not start work after stop begins', async function () {
            var workerManager = new lifecycle.WorkerManager();
            var release;
            var runCount = 0;
            workerManager.register('task', function () {
                runCount++;
                return new Promise(function (resolve) { release = resolve; });
            });

            var firstRun = workerManager.runOnce('task');
            await Promise.resolve();
            var chainedRun = firstRun.then(function () {
                return workerManager.runOnce('task');
            }).catch(function (error) {
                expect(error.message).to.equal('Worker manager is stopped');
            });
            var stopped = workerManager.stop();
            release();

            await Promise.all([stopped, chainedRun]);
            expect(runCount).to.equal(1);
            expect(workerManager.workers.task.running).to.be(false);

            await workerManager.runOnce('task').then(function () {
                throw new Error('post-stop worker unexpectedly ran');
            }, function (error) {
                expect(error.message).to.equal('Worker manager is stopped');
            });
            expect(runCount).to.equal(1);
        });
    });

    describe('DatabaseManager', function () {
        it('connects with pool options and disconnects cleanly', function (done) {
            var dbManager = new lifecycle.DatabaseManager();

            dbManager.connect({
                databaseUrl: config.databaseUrl,
                maxPoolSize: 20,
                minPoolSize: 1
            }, function (err, connectedDb, connectedClient) {
                if (err) return done(err);
                expect(connectedDb).to.be.ok();
                expect(connectedClient).to.be.ok();
                expect(dbManager.isManaged).to.be(true);

                dbManager.disconnect(false, function (err) {
                    if (err) return done(err);
                    expect(dbManager.client).to.be(null);
                    done();
                });
            });
        });

        it('respects injected client/db without closing external connections', function (done) {
            var dbManager = new lifecycle.DatabaseManager();

            dbManager.connect({
                client: dbClient,
                db: db
            }, function (err, connectedDb, connectedClient) {
                if (err) return done(err);
                expect(connectedDb).to.equal(db);
                expect(connectedClient).to.equal(dbClient);
                expect(dbManager.isManaged).to.be(false);

                // Disconnect should NOT close the external client
                dbManager.disconnect(false, function (err) {
                    if (err) return done(err);

                    // dbClient should still be open and operational
                    db.collection('things').countDocuments({}, function (err, count) {
                        if (err) return done(err);
                        expect(typeof count).to.equal('number');
                        done();
                    });
                });
            });
        });
    });

    describe('ShutdownManager', function () {
        it('waits for an active worker before disconnecting Mongo', async function () {
            var events = [];
            var workerManager = new lifecycle.WorkerManager();
            workerManager.register('task', function () {
                return new Promise(function (resolve) {
                    setTimeout(function () {
                        events.push('worker');
                        resolve();
                    }, 100);
                });
            });
            workerManager.runOnce('task');

            var shutdownManager = new lifecycle.ShutdownManager({
                workerManager: workerManager,
                databaseManager: {
                    disconnect: function () {
                        events.push('mongo');
                        return Promise.resolve();
                    }
                }
            });

            await shutdownManager.shutdown('manual');
            expect(events).to.eql(['worker', 'mongo']);
        });

        it('lets a five-second in-flight request finish after SIGTERM', function (done) {
            this.timeout(8000);

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
                }, 1000);
                setTimeout(function () { res.end('finished'); }, 5000);
            });

            server.listen(0, '127.0.0.1', function () {
                port = server.address().port;
                var shutdownManager = new lifecycle.ShutdownManager({
                    server: server,
                    workerManager: { stop: function () { events.push('workers'); } },
                    databaseManager: {
                        disconnect: function () {
                            events.push('mongo');
                            return Promise.resolve();
                        }
                    },
                    timeoutMs: 6000
                });
                shutdownManager.attachSignals(function (err) {
                    if (err) return done(err);
                    expect(events).to.eql(['response', 'workers', 'mongo']);
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
                workerManager: { stop: function () { events.push('workers'); } },
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
            expect(events).to.eql(['socket', 'workers', 'mongo']);
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

        it('shuts down workers, HTTP server, and database sequentially and idempotently', function (done) {
            var server = http.createServer(function (req, res) {
                res.writeHead(200);
                res.end('ok');
            });

            server.listen(0, '127.0.0.1', function () {
                var workerManager = new lifecycle.WorkerManager();
                workerManager.register('task', function (next) { next(); }, 1000);
                workerManager.start();

                var dbManager = new lifecycle.DatabaseManager();
                dbManager.connect({ databaseUrl: config.databaseUrl }, function (err) {
                    if (err) return done(err);

                    var shutdownManager = new lifecycle.ShutdownManager({
                        server: server,
                        databaseManager: dbManager,
                        workerManager: workerManager,
                        timeoutMs: 5000
                    });

                    shutdownManager.shutdown('SIGTERM', function (err) {
                        if (err) return done(err);
                        expect(workerManager.isRunning()).to.be(false);
                        expect(dbManager.client).to.be(null);

                        // Second call should be a no-op / idempotent
                        shutdownManager.shutdown('SIGTERM', function (err2) {
                            if (err2) return done(err2);
                            done();
                        });
                    });
                });
            });
        });
    });

    describe('startServer integration & lifecycle', function () {
        var runningInstance;

        afterEach(function (done) {
            if (runningInstance) {
                var inst = runningInstance;
                runningInstance = null;
                inst.close(done);
            } else {
                done();
            }
        });

        it('starts server on free port and handles HTTP requests cleanly', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                enableWorkers: false,
                autoAttachSignals: false,
                sessionMemory: true
            }, function (err, instance) {
                if (err) return done(err);
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
            });
        });

        it('supports dependency injection of pre-existing client and db', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                client: dbClient,
                db: db,
                enableWorkers: false,
                autoAttachSignals: false,
                sessionMemory: true
            }, function (err, instance) {
                if (err) return done(err);
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
                    instance.close(function (err) {
                        if (err) return done(err);
                        db.collection('things').countDocuments({}, function (err, count) {
                            if (err) return done(err);
                            expect(typeof count).to.equal('number');
                            done();
                        });
                    });
                });
                req.on('error', done);
            });
        });

        it('fails gracefully and reports error when database connection fails', function (done) {
            appModule.startServer({
                port: 0,
                bindAddress: '127.0.0.1',
                databaseUrl: 'mongodb://127.0.0.1:19999/invalid-db-test',
                serverSelectionTimeoutMS: 500,
                enableWorkers: false,
                autoAttachSignals: false,
                sessionMemory: true
            }, function (err, instance) {
                expect(err).to.be.ok();
                expect(instance).to.be(undefined);
                done();
            });
        });
    });
});
