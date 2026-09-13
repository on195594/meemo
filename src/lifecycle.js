/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    config = require('./config.js'),
    defaultLogger = require('./http/middleware/logger.js').defaultLogger,
    nodeify = require('./promise.js');

function durationMs(startTime) {
    var elapsed = process.hrtime(startTime);
    return Math.round(((elapsed[0] * 1e3) + (elapsed[1] * 1e-6)) * 100) / 100;
}

function writeLog(logger, record) {
    try { logger.write(record); } catch (error) {}
}

function runWorker(worker) {
    if (worker.length === 0) return Promise.resolve().then(worker);
    return new Promise(function (resolve, reject) {
        worker(function (error) { if (error) reject(error); else resolve(); });
    });
}

function WorkerManager(options) {
    this.options = options || {};
    this.logger = this.options.logger || defaultLogger;
    this.workers = {};
    this.timers = {};
    this.running = false;
    this.stopped = false;
    this.stopPromise = null;
}

WorkerManager.prototype.register = function (name, workerFn, intervalMs) {
    if (typeof workerFn !== 'function') throw new TypeError('Worker task must be a function');
    this.workers[name] = { fn: workerFn, intervalMs: intervalMs || 60000, running: false, promise: null };
};

WorkerManager.prototype._run = function (name) {
    var worker = this.workers[name];
    if (!worker) return Promise.reject(new Error('Worker [' + name + '] not found'));
    if (this.stopped) return Promise.reject(new Error('Worker manager is stopped'));
    if (worker.running) return worker.promise;

    var self = this;
    var startTime = process.hrtime();
    worker.running = true;
    worker.promise = runWorker(worker.fn).then(function (result) {
        worker.running = false;
        worker.promise = null;
        writeLog(self.logger, {
            level: 'info',
            event: 'worker_completed',
            worker: name,
            durationMs: durationMs(startTime)
        });
        return result;
    }, function (error) {
        worker.running = false;
        worker.promise = null;
        writeLog(self.logger, {
            level: 'error',
            event: 'worker_failed',
            worker: name,
            durationMs: durationMs(startTime),
            error: { code: (error && error.code) || 'worker_error' }
        });
        throw error;
    });
    return worker.promise;
};

WorkerManager.prototype.start = function () {
    if (this.running || this.stopPromise) return;
    this.stopped = false;
    this.running = true;

    var self = this;
    Object.keys(this.workers).forEach(function (name) {
        var worker = self.workers[name];
        self.timers[name] = setInterval(function () {
            if (worker.running) return;
            self._run(name).catch(function (error) {
                console.error('Worker error in [' + name + ']:', error);
            });
        }, worker.intervalMs);
        if (self.timers[name].unref) self.timers[name].unref();
    });
};

WorkerManager.prototype.stop = function (callback) {
    if (this.stopPromise) return nodeify(this.stopPromise, callback);

    var self = this;
    this.stopped = true;
    Object.keys(this.timers).forEach(function (name) {
        clearInterval(self.timers[name]);
        delete self.timers[name];
    });
    this.running = false;

    var pending = Object.keys(this.workers).map(function (name) {
        return self.workers[name].promise;
    }).filter(Boolean).map(function (promise) {
        return promise.catch(function () {});
    });
    this.stopPromise = Promise.all(pending).then(function () {
        self.stopPromise = null;
    });
    return nodeify(this.stopPromise, callback);
};

WorkerManager.prototype.isRunning = function () {
    return this.running;
};

WorkerManager.prototype.runOnce = function (name, callback) {
    return nodeify(this._run(name), callback);
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
    this.timeoutMs = options.timeoutMs !== undefined ? options.timeoutMs : (parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 15000);
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
    this.shutdownPromise = Promise.resolve().then(async function () {
        try {
            if (self.server) {
                await new Promise(function (resolve) {
                    var timeoutTimer;
                    var settled = false;
                    function finish(error) {
                        if (settled) return;
                        settled = true;
                        clearTimeout(timeoutTimer);
                        if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') console.error('Error closing HTTP server:', error);
                        resolve();
                    }

                    timeoutTimer = setTimeout(function () {
                        console.warn('Graceful shutdown timed out after ' + self.timeoutMs + 'ms, forcing socket termination');
                        self.trackedSockets.forEach(function (socket) {
                            try { socket.destroy(); } catch (error) {}
                        });
                        finish();
                    }, self.timeoutMs);
                    if (timeoutTimer.unref) timeoutTimer.unref();

                    try {
                        self.server.close(finish);
                    } catch (error) {
                        finish(error);
                    }
                });
            }

            if (self.workerManager) await self.workerManager.stop();
            if (self.databaseManager) {
                try { await self.databaseManager.disconnect(false); } catch (error) { console.error('Error disconnecting MongoDB:', error); }
            }
        } finally {
            self.detachSignals();
        }
    });

    return nodeify(this.shutdownPromise, callback);
};

module.exports = {
    WorkerManager: WorkerManager,
    DatabaseManager: DatabaseManager,
    ShutdownManager: ShutdownManager
};
