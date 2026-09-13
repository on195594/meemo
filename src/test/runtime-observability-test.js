'use strict';

/* global describe:false */
/* global it:false */

var EventEmitter = require('events'),
    expect = require('expect.js'),
    health = require('../services/health-service.js'),
    lifecycle = require('../lifecycle.js'),
    logger = require('../http/middleware/logger.js'),
    gcCli = require('../../scripts/gc-attachments.js');

describe('Runtime observability', function () {
    it('records structured request latency and 5xx status', function () {
        var logs = [];
        var customLogger = logger.createLogger({ forceEnable: true, stream: function (entry) { logs.push(entry); } });
        var response = new EventEmitter();
        response.statusCode = 503;
        response.locals = { errorCode: 'service_unavailable' };
        response.setHeader = function () {};

        customLogger.middleware({ headers: {}, method: 'GET', path: '/failed' }, response, function () {});
        response.emit('finish');

        expect(logs[0].event).to.equal('http_request');
        expect(logs[0].status).to.equal(503);
        expect(logs[0].level).to.equal('error');
        expect(logs[0].durationMs).to.be.a('number');
    });

    it('reports bounded process memory fields for health responses', function () {
        var stats = health.processStats();
        expect(stats.uptimeSeconds).to.be.a('number');
        expect(stats.memory.rssBytes).to.be.a('number');
        expect(stats.memory.heapUsedBytes).to.be.a('number');
        expect(stats.memory.heapTotalBytes).to.be.a('number');
        expect(stats.memory.externalBytes).to.be.a('number');
    });

    it('logs worker completion and failure at the worker owner', async function () {
        var logs = [];
        var workerManager = new lifecycle.WorkerManager({ logger: { write: function (entry) { logs.push(entry); } } });
        workerManager.register('success', function () {});
        workerManager.register('failure', function () { throw new Error('failed'); });

        await workerManager.runOnce('success');
        await workerManager.runOnce('failure').catch(function () {});

        expect(logs[0].event).to.equal('worker_completed');
        expect(logs[0].worker).to.equal('success');
        expect(logs[0].durationMs).to.be.a('number');
        expect(logs[1].event).to.equal('worker_failed');
        expect(logs[1].worker).to.equal('failure');
        expect(logs[1].error.code).to.equal('worker_error');
    });

    it('structures attachment GC completion and failure records', function () {
        var completed = gcCli.completionRecord({ mode: 'dry-run', filesScanned: 4, orphansFound: 2, eligibleForDeletion: 1, deleted: 0 });
        var failed = gcCli.failureRecord(new Error('scan failed'), 'apply');

        expect(completed.event).to.equal('attachment_gc_completed');
        expect(completed.storageBackend).to.equal('local');
        expect(completed.filesScanned).to.equal(4);
        expect(failed.event).to.equal('attachment_gc_failed');
        expect(failed.storageBackend).to.equal('local');
        expect(failed.mode).to.equal('apply');
        expect(failed.error.code).to.equal('attachment_gc_error');
    });
});
