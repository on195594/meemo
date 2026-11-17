/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    config = require('./config.js');

function DatabaseManager() {
    this.client = null;
    this.db = null;
    this.isManaged = false;
    this.prevConfigDb = null;
}

DatabaseManager.prototype.connect = async function (options) {
    var self = this;
    options = options || {};
    this.prevConfigDb = config.db;

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
};

DatabaseManager.prototype.disconnect = async function (force = false) {
    var self = this;
    if (self.client && self.isManaged) await self.client.close(Boolean(force));
    self.client = null;
    self.db = null;
    if (self.prevConfigDb) config.db = self.prevConfigDb;
};

function ShutdownManager(options) {
    options = options || {};
    this.server = options.server || null;
    this.databaseManager = options.databaseManager || null;
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

ShutdownManager.prototype.shutdown = function (signal) {
    if (this.shutdownPromise) return this.shutdownPromise;

    var self = this;
    this.isShuttingDown = true;
    this.shutdownPromise = (async function () {
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

            if (self.databaseManager) {
                try { await self.databaseManager.disconnect(false); } catch (error) { console.error('Error disconnecting MongoDB:', error); }
            }
        } finally {
            self.detachSignals();
        }
    })();

    return this.shutdownPromise;
};

module.exports = {
    DatabaseManager: DatabaseManager,
    ShutdownManager: ShutdownManager
};
