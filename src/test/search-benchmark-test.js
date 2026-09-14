'use strict';

/* global after:false */
/* global before:false */
/* global describe:false */
/* global it:false */

var expect = require('expect.js'),
    MongoClient = require('mongodb').MongoClient,
    benchmark = require('../../scripts/benchmark-search.js'),
    config = require('../config.js');

describe('Search benchmark', function () {
    var client;
    var db;
    var ownerId = 'vr212-benchmark-test-' + process.pid;

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
    });

    after(async function () {
        await db.collection('things').deleteMany({ ownerId: ownerId });
        await client.close();
    });

    it('measures the real application and Mongo query paths', async function () {
        var result = await benchmark.benchmarkDataset(db, {
            size: 100,
            ownerId: ownerId,
            warmupRuns: 1,
            repetitions: 2,
            scenarios: [benchmark.SCENARIOS.find(function (scenario) { return scenario.name === 'multi-term'; })]
        });

        expect(result.fixtureSize).to.equal(100);
        expect(result.scenarios.length).to.equal(1);
        expect(result.scenarios[0].documentsReturned).to.equal(5);
        expect(result.scenarios[0].latencyMs.p50).to.be.a('number');
        expect(result.scenarios[0].latencyMs.p95).to.be.a('number');
        expect(result.scenarios[0].mongo.nReturned).to.equal(5);
        expect(result.scenarios[0].mongo.totalDocsExamined).to.be.a('number');
        expect(result.scenarios[0].mongo.totalKeysExamined).to.be.a('number');
        expect(await db.collection('things').countDocuments({ ownerId: ownerId })).to.equal(0);
    });
});