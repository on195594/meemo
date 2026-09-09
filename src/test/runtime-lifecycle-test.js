'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */
/* global afterEach:false */

var expect = require('expect.js');
var http = require('http');
var MongoClient = require('mongodb').MongoClient;
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

        it('safely catches errors inside workers without crashing', function (done) {
            var workerManager = new lifecycle.WorkerManager();

            workerManager.register('failingTask', function (next) {
                next(new Error('Simulated worker failure'));
            });

            workerManager.runOnce('failingTask', function (err) {
                expect(err).to.be.ok();
                expect(err.message).to.equal('Simulated worker failure');
                done();
            });
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
