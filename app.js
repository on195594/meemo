#!/usr/bin/env node

'use strict';

const PORT = process.env.VITE_DEV_PORT || process.env.PORT || 3000;
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

var createApp = require('./src/http/app.js'),
    lifecycle = require('./src/lifecycle.js'),
    things = require('./src/database/things.js'),
    tags = require('./src/database/tags.js'),
    settings = require('./src/database/settings.js'),
    nodeify = require('./src/promise.js');

function exit(error) {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
}

function startServer(options, callback) {
    options = options || {};

    var promise = Promise.resolve().then(async function () {
        var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
        var sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
        if (isProduction && !sessionSecret) {
            throw new Error('FATAL: SESSION_SECRET is required when NODE_ENV=production');
        }

        var databaseManager = new lifecycle.DatabaseManager();
        var workerManager = new lifecycle.WorkerManager();
        var shutdownManager = new lifecycle.ShutdownManager({
            databaseManager: databaseManager,
            workerManager: workerManager,
            timeoutMs: options.shutdownTimeoutMs
        });
        var connection = await databaseManager.connect(options);
        await Promise.all([
            things.ensureIndexes(),
            tags.ensureIndexes(),
            settings.ensureIndexes()
        ]);

        var app = createApp(Object.assign({}, options, { shutdownManager: shutdownManager }));
        var port = options.port !== undefined ? options.port : PORT;
        var bindAddress = options.bindAddress || BIND_ADDRESS;
        var server = await new Promise(function (resolve, reject) {
            var listener = app.listen(port, bindAddress, function () {
                listener.removeListener('error', reject);
                resolve(listener);
            });
            listener.once('error', reject);
        });

        console.log('App listening at http://%s:%s', server.address().address, server.address().port);
        shutdownManager.trackServer(server);
        var enableWorkers = options.enableWorkers !== undefined ? options.enableWorkers : (process.env.ENABLE_WORKERS !== 'false');
        if (enableWorkers) workerManager.start();
        if (options.autoAttachSignals !== false) shutdownManager.attachSignals();

        return {
            app: app,
            server: server,
            client: connection.client,
            db: connection.db,
            workers: workerManager,
            databaseManager: databaseManager,
            shutdownManager: shutdownManager,
            close: function (done) { return shutdownManager.shutdown('close', done); }
        };
    });

    return nodeify(promise, callback);
}

if (require.main === module) startServer().catch(exit);

module.exports = {
    createApp: createApp,
    startServer: startServer,
    lifecycle: lifecycle
};
