'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { MongoClient } = require('mongodb');
const config = require('../config.js');
const relevance = require('../../scripts/search-relevance.js');
const benchmark = require('../../scripts/benchmark-search.js');

function dataset() {
    return JSON.parse(fs.readFileSync(relevance.fixturePath, 'utf8'));
}

describe('Synthetic search relevance baseline', function () {
    this.timeout(30000);
    let client;
    before(async function () { client = await MongoClient.connect(config.databaseUrl); });
    after(async function () { if (client) await client.close(); });
    function database() { return client.db(`meemo_relevance_${crypto.randomUUID().replace(/-/g, '')}`); }

    it('validates independent labels and rejects invalid modes, duplicate IDs and cross-owner expectations', function () {
        const fixture = dataset();
        relevance.validateDataset(fixture);
        fixture.notes.push(fixture.notes[0]);
        assert.throws(() => relevance.validateDataset(fixture), /Duplicate note IDs/);
        const invalidMode = dataset();
        invalidMode.cases[0].options.mode = 'vector';
        assert.throws(() => relevance.validateDataset(invalidMode));
        const wrongOwner = dataset();
        wrongOwner.cases[0].expected = ['bob'];
        assert.throws(() => relevance.validateDataset(wrongOwner), /query owner/);
    });

    it('evaluates the application path and fails an incorrect ranking oracle', async function () {
        const db = database();
        const previousDb = config.db;
        const report = await relevance.evaluateDataset(db, dataset());
        assert.equal(report.queries, 29);
        assert.equal(report.notes, 18);
        assert.equal(report.status, 'PASS');
        assert.deepEqual(report.failures, []);
        assert.equal(config.db, previousDb);
        assert.equal((await db.listCollections().toArray()).length, 0);
        const wrongRanking = dataset();
        wrongRanking.cases = [wrongRanking.cases.find(item => item.id === 'sticky-before-relevance')];
        wrongRanking.cases[0].expectedPrefix = ['rank-sparse'];
        const failed = await relevance.evaluateDataset(db, wrongRanking);
        assert.equal(failed.status, 'FAIL');
        assert.deepEqual(failed.failures, ['sticky-before-relevance']);
    });

    it('refuses an existing database and never suppresses isolation failures as known quality gaps', async function () {
        const db = database();
        await assert.rejects(() => relevance.evaluateDataset(client.db('meemo_not_verification'), dataset()), /its own database namespace/);
        try {
            await db.collection('sentinel').insertOne({ _id: 'untouched' });
            await assert.rejects(() => relevance.evaluateDataset(db, dataset()), /existing database/);
            assert(await db.collection('sentinel').findOne({ _id: 'untouched' }));
        } finally {
            await db.dropDatabase();
        }
        const original = benchmark.runApplicationScenario;
        const previousDb = config.db;
        try {
            const knownGap = dataset();
            // The corpus has no known gaps; derive one so the mechanism stays covered.
            knownGap.cases = [{ ...knownGap.cases.find(item => item.id === 'chinese-backup-regex'), id: 'synthetic-known-gap', knownGap: 'test-only gap' }];
            benchmark.runApplicationScenario = (owner, scenario, limit) => original('alice', { options: { filter: 'wyvernmissingterm', mode: 'text' } }, limit);
            const missed = await relevance.evaluateDataset(db, knownGap);
            assert.equal(missed.status, 'PASS_WITH_KNOWN_GAPS');
            assert.deepEqual(missed.knownGaps, ['synthetic-known-gap']);
            benchmark.runApplicationScenario = (owner, scenario, limit) => original('alice', { options: { filter: '杭州', mode: 'regex' } }, limit);
            const falsePositive = await relevance.evaluateDataset(db, knownGap);
            assert.equal(falsePositive.status, 'FAIL');
            assert.deepEqual(falsePositive.failures, ['synthetic-known-gap']);
            benchmark.runApplicationScenario = (owner, scenario, limit) => original('bob', { options: { filter: 'quartz', mode: 'text' } }, limit);
            await assert.rejects(() => relevance.evaluateDataset(db, knownGap), /Owner isolation failure/);
            assert.equal(config.db, previousDb);
            assert.equal((await db.listCollections().toArray()).length, 0);
        } finally {
            benchmark.runApplicationScenario = original;
        }
    });
});
