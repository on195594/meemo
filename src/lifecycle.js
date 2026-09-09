/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    config = require('./config.js'),
    nodeify = require('./promise.js');

function runWorker(worker) {
    if (worker.length === 0) return Promise.resolve().then(worker);
    return new Promise(function (resolve, reject) {
        worker(function (error) { if (error) reject(error); else resolve(); });
    });
}

function WorkerManager(options) {
    this.options = options || {};
    this.workers = {};
    this.timers = {};
    this.running = false;
}

WorkerManager.prototype.register = function (name, workerFn, intervalMs) {
    if (typeof workerFn !== 'function') throw new TypeError('Worker task must be a function');
    this.workers[name] = { fn: workerFn, intervalMs: intervalMs || 60000 };
};

WorkerManager.prototype.start = function () {
    if (this.running) return;
    this.running = true;

    var self = this;
    Object.keys(this.workers).forEach(function (name) {
        var worker = self.workers[name];
        self.timers[name] = setInterval(function () {
            runWorker(worker.fn).catch(function (error) {
                console.error('Worker error in [' + name + ']:', error);
            });
        }, worker.intervalMs);
        if (self.timers[name].unref) self.timers[name].unref();
    });
};

WorkerManager.prototype.stop = function () {
    var self = this;
    Object.keys(this.timers).forEach(function (name) {
        clearInterval(self.timers[name]);
        delete self.timers[name];
    });
    this.running = false;
};

WorkerManager.prototype.isRunning = function () {
    return this.running;
};

WorkerManager.prototype.runOnce = function (name, callback) {
    var worker = this.workers[name];
    var promise = worker ? runWorker(worker.fn) : Promise.reject(new Error('Worker [' + name + '] not found'));
    return nodeify(promise, callback);
};

function DatabaseManager() {
    this.client = null;
    this.db = null;
    this.isManaged = false;
    this.prevConfigDb = null;
}

DatabaseManager.prototype.connect = function (options, callback) {
    var self = this;
    options = options || {};
    this.prevConfigDb = config.db;

    var promise = Promise.resolve().then(async function () {
        if (options.db) {
            self.db = options.db;
            self.client = options.client || null;
            self.isManaged = false;
        } else if (options.client) {
            self.client = options.client;
            self.db = options.client.db();
            self.isManaged = false;
        } else {
            self.client = await MongoClient.connect(options.databaseUrl || config.databaseUrl || 'mongodb://127.0.0.1:27017/meemo', {
                useUnifiedTopology: true,
                maxPoolSize: options.maxPoolSize || parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 50,
                minPoolSize: options.minPoolSize || parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 1,
                serverSelectionTimeoutMS: options.serverSelectionTimeoutMS || parseInt(process.env.MONGO_TIMEOUT_MS, 10) || 3000
            });
            self.db = self.client.db();
            self.isManaged = true;
        }
        config.db = self.db;
        return { db: self.db, client: self.client };
    });

    if (typeof callback !== 'function') return promise;
    promise.then(function (result) { callback(null, result.db, result.client); }, callback);
};

DatabaseManager.prototype.disconnect = function (force, callback) {
    if (typeof force === 'function') {
        callback = force;
        force = false;
    }
    var self = this;
    var promise = Promise.resolve().then(async function () {
        if (self.client && self.isManaged) await self.client.close(Boolean(force));
        self.client = null;
        self.db = null;
        if (self.prevConfigDb) config.db = self.prevConfigDb;
    });
    return nodeify(promise, callback);
};

function ShutdownManager(options) {
    options = options || {};
    this.server = options.server || null;
    this.databaseManager = options.databaseManager || null;
    this.workerManager = options.workerManager || null;
    this.timeoutMs = options.timeoutMs || parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10000;
    this.isShuttingDown = false;
    this.shutdownPromise = null;
    this.trackedSockets = new Set();
    this._signalHandlers = {};
    if (this.server) this.trackServer(this.server);
}

ShutdownManager.prototype.trackServer = function (server) {
    this.server = server;
    var self = this;
    server.on('connection', function (socket) {
        self.trackedSockets.add(socket);
        socket.on('close', function () { self.trackedSockets.delete(socket); });
    });
};

ShutdownManager.prototype.attachSignals = function (onShutdownComplete) {
    var self = this;
    ['SIGTERM', 'SIGINT'].forEach(function (signal) {
        self._signalHandlers[signal] = function () {
            self.shutdown(signal).then(function () {
                if (onShutdownComplete) return onShutdownComplete(null);
                process.exit(0);
            }, function (error) {
                if (onShutdownComplete) return onShutdownComplete(error);
                process.exit(1);
            });
        };
        process.on(signal, self._signalHandlers[signal]);
    });
};

ShutdownManager.prototype.detachSignals = function () {
    var self = this;
    Object.keys(this._signalHandlers).forEach(function (signal) {
        process.removeListener(signal, self._signalHandlers[signal]);
        delete self._signalHandlers[signal];
    });
};

ShutdownManager.prototype.shutdown = function (signal, callback) {
    if (typeof signal === 'function') {
        callback = signal;
        signal = 'manual';
    }
    if (this.shutdownPromise) return nodeify(this.shutdownPromise, callback);

    var self = this;
    this.isShuttingDown = true;
    var timeoutTimer;
    this.shutdownPromise = Promise.race([
        Promise.resolve().then(async function () {
            if (self.workerManager) self.workerManager.stop();
            self.trackedSockets.forEach(function (socket) {
                try { socket.destroy(); } catch (error) {}
            });

            if (self.server) {
                await new Promise(function (resolve) {
                    try {
                        self.server.close(function (error) {
                            if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') console.error('Error closing HTTP server:', error);
                            resolve();
                        });
                    } catch (error) {
                        resolve();
                    }
                });
            }
            if (self.databaseManager) {
                try { await self.databaseManager.disconnect(false); } catch (error) { console.error('Error disconnecting MongoDB:', error); }
            }
            self.detachSignals();
        }),
        new Promise(function (resolve, reject) {
            timeoutTimer = setTimeout(function () {
                console.warn('Graceful shutdown timed out after ' + self.timeoutMs + 'ms, forcing socket termination');
                self.trackedSockets.forEach(function (socket) {
                    try { socket.destroy(); } catch (error) {}
                });
                self.detachSignals();
                reject(new Error('Graceful shutdown timed out'));
            }, self.timeoutMs);
            if (timeoutTimer.unref) timeoutTimer.unref();
        })
    ]).finally(function () {
        clearTimeout(timeoutTimer);
    });

    return nodeify(this.shutdownPromise, callback);
};

module.exports = {
    WorkerManager: WorkerManager,
    DatabaseManager: DatabaseManager,
    ShutdownManager: ShutdownManager
};
