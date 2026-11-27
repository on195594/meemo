#!/usr/bin/env node

'use strict';

const PORT = process.env.VITE_DEV_PORT || process.env.PORT || 3000;
const BIND_ADDRESS = process.env.BIND_ADDRESS || '0.0.0.0';

var createApp = require('./src/http/app.js'),
    lifecycle = require('./src/lifecycle.js'),
    things = require('./src/database/things.js'),
    settings = require('./src/database/settings.js');

function exit(error) {
    if (error) console.error(error);
    process.exit(error ? 1 : 0);
}

async function startServer(options) {
    options = options || {};

    var isProduction = options.isProduction !== undefined ? options.isProduction : (process.env.NODE_ENV === 'production');
    var sessionSecret = options.sessionSecret || process.env.SESSION_SECRET;
    if (isProduction && !sessionSecret) {
        throw new Error('FATAL: SESSION_SECRET is required when NODE_ENV=production');
    }
    require('./src/users.js').assertMongoUserSource(options.authUserSource, isProduction);

    var databaseManager = new lifecycle.DatabaseManager();
    var shutdownManager = new lifecycle.ShutdownManager({
        databaseManager: databaseManager,
        timeoutMs: options.shutdownTimeoutMs
    });
    var connection = await databaseManager.connect(options);
    await Promise.all([
        things.ensureIndexes(),
        settings.ensureIndexes(),
        require('./src/users.js').getRepository().ensureIndexes()
    ]);

    var app = createApp(Object.assign({}, options, { client: connection.client, shutdownManager: shutdownManager }));
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
    if (options.autoAttachSignals !== false) shutdownManager.attachSignals();

    return {
        app: app,
        server: server,
        client: connection.client,
        db: connection.db,
        databaseManager: databaseManager,
        shutdownManager: shutdownManager,
        close: function () { return shutdownManager.shutdown('close'); }
    };
}

if (require.main === module) startServer().catch(exit);

module.exports = {
    createApp: createApp,
    startServer: startServer,
    lifecycle: lifecycle
};
