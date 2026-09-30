'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MongoClient, ObjectId } = require('mongodb');
const { z } = require('zod');
const config = require('../src/config.js');
const things = require('../src/database/things.js');
const thingService = require('../src/services/thing-service.js');
const benchmark = require('./benchmark-search.js');
const isolation = require('./verification-docker.js');

const fixturePath = path.join(__dirname, 'fixtures/search-relevance.json');
const identifier = z.string().min(1);
const schema = z.object({
    schemaVersion: z.literal(1),
    provenance: identifier,
    notes: z.array(z.object({
        id: identifier, owner: identifier, content: identifier, tags: z.array(identifier),
        archived: z.boolean().optional(), sticky: z.boolean().optional(), deleted: z.boolean().optional()
    }).strict()).min(1),
    cases: z.array(z.object({
        id: identifier, category: identifier, owner: identifier,
        options: z.object({ filter: identifier, mode: z.enum(['regex', 'text']), archived: z.boolean().optional(), deleted: z.boolean().optional(), sticky: z.boolean().optional() }).strict(),
        skip: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
        expected: z.array(identifier), expectedPrefix: z.array(identifier).min(1).optional(), knownGap: identifier.optional()
    }).strict()).min(1)
}).strict();

function validateDataset(input) {
    const dataset = schema.parse(input);
    const notes = new Map(dataset.notes.map(note => [note.id, note]));
    assert.equal(notes.size, dataset.notes.length, 'Duplicate note IDs');
    assert.equal(new Set(dataset.cases.map(item => item.id)).size, dataset.cases.length, 'Duplicate query IDs');
    for (const item of dataset.cases) {
        assert(dataset.notes.some(note => note.owner === item.owner), 'Query owner must exist in the corpus');
        assert.equal(new Set(item.expected).size, item.expected.length, 'Duplicate relevance labels');
        for (const id of item.expected) assert.equal(notes.get(id)?.owner, item.owner, 'Relevance labels must belong to the query owner');
        if (item.expectedPrefix) {
            assert.equal(new Set(item.expectedPrefix).size, item.expectedPrefix.length, 'Duplicate ranking labels');
            assert(item.expectedPrefix.every(id => item.expected.includes(id)), 'Ranking labels must be relevant IDs');
        }
    }
    return dataset;
}

async function evaluateDataset(db, input) {
    const dataset = validateDataset(input);
    assert(db.databaseName.startsWith('meemo_relevance_'), 'Relevance verification requires its own database namespace');
    assert.equal((await db.listCollections().toArray()).length, 0, 'Refusing to overwrite an existing database');
    const originalDb = config.db;
    const records = dataset.notes.map((note, index) => ({
        _id: new ObjectId((index + 1).toString(16).padStart(24, '0')),
        ownerId: note.owner, content: note.content, tags: note.tags, revision: 1,
        archived: !!note.archived, sticky: !!note.sticky, public: false, shared: false,
        attachments: [], externalContent: [], createdAt: 1700000000000 + index, modifiedAt: 1700000000000 + index,
        ...(note.deleted ? { deletedAt: 1700000001000 + index } : {})
    }));
    const ids = new Map(records.map((record, index) => [String(record._id), dataset.notes[index].id]));
    config.db = db;
    try {
        await things.ensureIndexes();
        await db.collection('things').insertMany(records);
        const results = [];
        for (const item of dataset.cases) {
            const limit = item.limit || 10;
            const started = process.hrtime.bigint();
            const found = await benchmark.runApplicationScenario(item.owner, item, limit, item.skip || 0);
            const latencyMs = Number(process.hrtime.bigint() - started) / 1e6;
            for (const thing of found) {
                assert(ids.has(thing._id), 'Unexpected document outside the synthetic corpus');
                assert.equal(thing.ownerId, item.owner, 'Owner isolation failure');
                assert.equal(!!thing.deletedAt, !!item.options.deleted, 'Trash visibility failure');
                if (!item.options.deleted) assert.equal(thing.archived, !!item.options.archived, 'Archive visibility failure');
                if (item.options.sticky) assert(thing.sticky, 'Sticky filter failure');
                if (!thing.deletedAt) {
                    const opened = await thingService.get(item.owner, thing._id);
                    assert.equal(opened.content, thing.content, 'Stable-ID readback failure');
                    const otherOwner = dataset.notes.find(note => note.owner !== item.owner)?.owner;
                    if (otherOwner) await assert.rejects(() => thingService.get(otherOwner, thing._id), /not found/);
                }
            }
            const actual = found.map(thing => ids.get(thing._id));
            assert.equal(new Set(actual).size, actual.length, 'Duplicate result IDs');
            const missing = item.expected.filter(id => !actual.includes(id));
            const unexpected = actual.filter(id => !item.expected.includes(id));
            const rankingMatches = !item.expectedPrefix || item.expectedPrefix.every((id, index) => actual[index] === id);
            const passed = !missing.length && !unexpected.length && rankingMatches;
            results.push({
                id: item.id, category: item.category, options: item.options, limit, skip: item.skip || 0,
                expected: item.expected, expectedPrefix: item.expectedPrefix, actual, missing, unexpected, rankingMatches,
                // A documented miss never excuses new false positives, ranking regressions or isolation errors.
                status: passed ? 'PASS' : item.knownGap && !unexpected.length && rankingMatches ? 'KNOWN_GAP' : 'FAIL', knownGap: item.knownGap,
                recallAtLimit: item.expected.length ? (item.expected.length - missing.length) / item.expected.length : (actual.length ? 0 : 1),
                precisionAtLimit: actual.length ? (actual.length - unexpected.length) / actual.length : (item.expected.length ? 0 : 1),
                latencyMs: Math.round(latencyMs * 1000) / 1000
            });
        }
        const failures = results.filter(item => item.status === 'FAIL').map(item => item.id);
        const knownGaps = results.filter(item => item.status === 'KNOWN_GAP').map(item => item.id);
        const positive = results.filter(item => item.expected.length);
        return {
            status: failures.length ? 'FAIL' : knownGaps.length ? 'PASS_WITH_KNOWN_GAPS' : 'PASS',
            scope: 'synthetic service-path relevance; not browser acceptance or representative production latency',
            provenance: dataset.provenance,
            datasetSha256: crypto.createHash('sha256').update(JSON.stringify(dataset)).digest('hex'),
            notes: dataset.notes.length, queries: results.length,
            passed: results.filter(item => item.status === 'PASS').length, failures, knownGaps,
            meanRecallAtLimit: positive.reduce((total, item) => total + item.recallAtLimit, 0) / (positive.length || 1),
            results
        };
    } finally {
        try {
            await db.dropDatabase();
        } finally {
            config.db = originalDb;
            things.resetCache();
        }
    }
}

async function verify() {
    if (process.argv.length !== 3 || process.argv[2] !== '--relevance') {
        throw new Error('Relevance verification accepts only --relevance; no external targets');
    }
    const dataset = validateDataset(JSON.parse(fs.readFileSync(fixturePath, 'utf8')));
    const runId = `meemo-relevance-${crypto.randomUUID()}`;
    console.error(`Verification run: ${runId}`);
    const container = `${runId}-mongo`;
    let client;
    try {
        const uri = await isolation.startMongo(container, runId);
        client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
        const report = await evaluateDataset(client.db(`meemo_relevance_${runId.slice(-36).replace(/-/g, '')}`), dataset);
        report.environment = { node: process.version, mongo: (await client.db().admin().serverInfo()).version };
        report.sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: isolation.root, encoding: 'utf8' }).trim();
        report.workingTreeDirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: isolation.root, encoding: 'utf8' }).trim();
        return report;
    } finally {
        try {
            if (client) await client.close();
        } finally {
            await isolation.removeOwned('container', container, runId);
        }
    }
}

async function main() {
    return isolation.withSignals(verify);
}

module.exports = { fixturePath, validateDataset, evaluateDataset, main };
