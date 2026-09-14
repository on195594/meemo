#!/usr/bin/env node

'use strict';

var lifecycle = require('../src/lifecycle.js'),
    attachments = require('../src/services/attachment-service.js'),
    logger = require('../src/http/middleware/logger.js').defaultLogger;

function completionRecord(result) {
    return Object.assign({}, result, {
        level: 'info',
        event: 'attachment_gc_completed',
        storageBackend: 'local'
    });
}

function failureRecord(error, mode) {
    return {
        level: 'error',
        event: 'attachment_gc_failed',
        storageBackend: 'local',
        mode: mode,
        error: { code: (error && error.code) || 'attachment_gc_error' }
    };
}

function parseArgs(argv) {
    var modes = argv.filter(function (argument) { return argument === '--dry-run' || argument === '--apply'; });
    var unknown = argv.filter(function (argument) { return argument !== '--dry-run' && argument !== '--apply'; });
    if (unknown.length) throw new Error('Unknown argument: ' + unknown[0]);
    if (modes.indexOf('--dry-run') !== -1 && modes.indexOf('--apply') !== -1) throw new Error('Choose either --dry-run or --apply');
    return { mode: modes.indexOf('--apply') !== -1 ? 'apply' : 'dry-run' };
}

async function run(argv) {
    var options = parseArgs(argv || []);
    var databaseManager = new lifecycle.DatabaseManager();
    await databaseManager.connect();
    try {
        return await attachments.garbageCollect({ apply: options.mode === 'apply' });
    } finally {
        await databaseManager.disconnect();
    }
}

if (require.main === module) {
    run(process.argv.slice(2)).then(function (result) {
        logger.write(completionRecord(result));
    }).catch(function (error) {
        logger.write(failureRecord(error, process.argv.indexOf('--apply') === -1 ? 'dry-run' : 'apply'));
        process.exitCode = 1;
    });
}

module.exports = {
    parseArgs: parseArgs,
    run: run,
    completionRecord: completionRecord,
    failureRecord: failureRecord
};
