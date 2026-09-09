/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    config = require('./config.js');

function WorkerManager(options) {
    this.options = options || {};
    this.workers = {};
    this.timers = {};
    this.running = false;
}

WorkerManager.prototype.register = function (name, workerFn, intervalMs) {
    if (typeof workerFn !== 'function') {
        throw new TypeError('Worker task must be a function');
    }
    this.workers[name] = {
        fn: workerFn,
        intervalMs: intervalMs || 60000
    };
};

WorkerManager.prototype.start = function () {
    if (this.running) return;
    this.running = true;

    var self = this;
    Object.keys(this.workers).forEach(function (name) {
        var worker = self.workers[name];
        self.timers[name] = setInterval(function () {
            try {
                worker.fn(function (err) {
                    if (err) {
                        console.error('Worker error in [' + name + ']:', err);
                    }
                });
            } catch (err) {
                console.error('Uncaught error executing worker [' + name + ']:', err);
            }
        }, worker.intervalMs);
        if (self.timers[name].unref) {
            self.timers[name].unref();
        }
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
    if (!worker) {
        var err = new Error('Worker [' + name + '] not found');
        if (callback) return callback(err);
        return;
    }

    try {
        worker.fn(function (err) {
            if (callback) callback(err || null);
        });
    } catch (err) {
        if (callback) callback(err);
    }
};

function DatabaseManager() {
    this.client = null;
    this.db = null;
    this.isManaged = false;
    this.prevConfigDb = null;
}

DatabaseManager.prototype.connect = function (options, callback) {
    options = options || {};
    this.prevConfigDb = config.db;

    if (options.db) {
        this.db = options.db;
        this.client = options.client || null;
        this.isManaged = false;
        config.db = this.db;
        return process.nextTick(function () {
            callback(null, options.db, options.client || null);
        });
    }

    if (options.client) {
        this.client = options.client;
        this.db = options.client.db();
        this.isManaged = false;
        config.db = this.db;
        var selfClient = this;
        return process.nextTick(function () {
            callback(null, selfClient.db, selfClient.client);
        });
    }

    var databaseUrl = options.databaseUrl || config.databaseUrl || 'mongodb://127.0.0.1:27017/meemo';
    var maxPoolSize = options.maxPoolSize || parseInt(process.env.MONGO_MAX_POOL_SIZE, 10) || 50;
    var minPoolSize = options.minPoolSize || parseInt(process.env.MONGO_MIN_POOL_SIZE, 10) || 1;
    var serverSelectionTimeoutMS = options.serverSelectionTimeoutMS || parseInt(process.env.MONGO_TIMEOUT_MS, 10) || 3000;

    var mongoOptions = {
        useUnifiedTopology: true,
        maxPoolSize: maxPoolSize,
        minPoolSize: minPoolSize,
        serverSelectionTimeoutMS: serverSelectionTimeoutMS
    };

    var self = this;
    MongoClient.connect(databaseUrl, mongoOptions, function (err, client) {
        if (err) return callback(err);
        self.client = client;
        self.db = client.db();
        self.isManaged = true;
        config.db = self.db;
        callback(null, self.db, self.client);
    });
};

DatabaseManager.prototype.disconnect = function (force, callback) {
    if (typeof force === 'function') {
        callback = force;
        force = false;
    }
    force = Boolean(force);

    var self = this;
    var restore = function () {
        if (self.prevConfigDb) {
            config.db = self.prevConfigDb;
        }
    };

    if (this.client && this.isManaged) {
        this.client.close(force, function (err) {
            self.client = null;
            self.db = null;
            restore();
            if (callback) callback(err || null);
        });
    } else {
        this.client = null;
        this.db = null;
        restore();
        if (callback) process.nextTick(function () { callback(null); });
    }
};

function ShutdownManager(options) {
    options = options || {};
    this.server = options.server || null;
    this.databaseManager = options.databaseManager || null;
    this.workerManager = options.workerManager || null;
    this.timeoutMs = options.timeoutMs || parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 10000;
    this.isShuttingDown = false;
    this.trackedSockets = new Set();
    this._signalHandlers = {};

    if (this.server) {
        this.trackServer(this.server);
    }
}

ShutdownManager.prototype.trackServer = function (server) {
    this.server = server;
    var self = this;
    server.on('connection', function (socket) {
        self.trackedSockets.add(socket);
        socket.on('close', function () {
            self.trackedSockets.delete(socket);
        });
    });
};

ShutdownManager.prototype.attachSignals = function (onShutdownComplete) {
    var self = this;
    this._signalHandlers.SIGTERM = function () {
        self.shutdown('SIGTERM', function (err) {
            if (onShutdownComplete) {
                return onShutdownComplete(err);
            }
            process.exit(err ? 1 : 0);
        });
    };
    this._signalHandlers.SIGINT = function () {
        self.shutdown('SIGINT', function (err) {
            if (onShutdownComplete) {
                return onShutdownComplete(err);
            }
            process.exit(err ? 1 : 0);
        });
    };

    process.on('SIGTERM', this._signalHandlers.SIGTERM);
    process.on('SIGINT', this._signalHandlers.SIGINT);
};

ShutdownManager.prototype.detachSignals = function () {
    if (this._signalHandlers.SIGTERM) {
        process.removeListener('SIGTERM', this._signalHandlers.SIGTERM);
        delete this._signalHandlers.SIGTERM;
    }
    if (this._signalHandlers.SIGINT) {
        process.removeListener('SIGINT', this._signalHandlers.SIGINT);
        delete this._signalHandlers.SIGINT;
    }
};

ShutdownManager.prototype.shutdown = function (signal, callback) {
    if (typeof signal === 'function') {
        callback = signal;
        signal = 'manual';
    }
    callback = callback || function () {};

    if (this.isShuttingDown) {
        return callback(null);
    }
    this.isShuttingDown = true;

    var self = this;
    var completed = false;

    var timeoutTimer = setTimeout(function () {
        if (completed) return;
        completed = true;
        console.warn('Graceful shutdown timed out after ' + self.timeoutMs + 'ms, forcing socket termination');
        self.trackedSockets.forEach(function (socket) {
            try { socket.destroy(); } catch (e) {}
        });
        self.detachSignals();
        callback(new Error('Graceful shutdown timed out'));
    }, this.timeoutMs);

    if (timeoutTimer.unref) {
        timeoutTimer.unref();
    }

    // Step 1: Stop workers
    if (this.workerManager) {
        this.workerManager.stop();
    }

    // Destroy idle/keep-alive sockets so server.close doesn't hang
    self.trackedSockets.forEach(function (socket) {
        try { socket.destroy(); } catch (e) {}
    });

    // Step 2: Stop accepting new HTTP connections
    var closeServer = function (next) {
        if (!self.server) return next();
        try {
            self.server.close(function (err) {
                if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
                    console.error('Error closing HTTP server:', err);
                }
                next();
            });
        } catch (e) {
            next();
        }
    };

    // Step 3: Disconnect database
    var closeDb = function (next) {
        if (!self.databaseManager) return next();
        self.databaseManager.disconnect(false, function (err) {
            if (err) {
                console.error('Error disconnecting MongoDB:', err);
            }
            next();
        });
    };

    closeServer(function () {
        closeDb(function () {
            if (completed) return;
            completed = true;
            clearTimeout(timeoutTimer);
            self.detachSignals();
            callback(null);
        });
    });
};

module.exports = {
    WorkerManager: WorkerManager,
    DatabaseManager: DatabaseManager,
    ShutdownManager: ShutdownManager
};
