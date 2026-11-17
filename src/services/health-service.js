'use strict';

var config = require('../config.js'),
    storage = require('../storage/local-storage.js');

function processStats() {
    var memory = process.memoryUsage();
    return {
        uptimeSeconds: process.uptime(),
        memory: {
            rssBytes: memory.rss,
            heapUsedBytes: memory.heapUsed,
            heapTotalBytes: memory.heapTotal,
            externalBytes: memory.external
        }
    };
}

async function ready() {
    if (!config.db) throw new Error('Database not connected');
    try {
        await config.db.command({ ping: 1 });
    } catch (error) {
        throw new Error('Database ping failed');
    }
    try {
        await storage.checkAccess();
    } catch (error) {
        throw new Error('Attachment directory not accessible');
    }
    return processStats();
}

module.exports = {
    ready: ready,
    processStats: processStats
};
