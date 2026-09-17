#!/usr/bin/env node

'use strict';

var MongoClient = require('mongodb').MongoClient,
    config = require('../src/config.js'),
    databaseThings = require('../src/database/things.js'),
    os = require('os'),
    search = require('../src/services/search-service.js'),
    thingService = require('../src/services/thing-service.js');

var SCENARIOS = [
    { name: 'single-keyword', options: { filter: 'benchmark', mode: 'regex', archived: false } },
    { name: 'chinese-keyword', options: { filter: '基准', mode: 'regex', archived: false } },
    { name: 'multi-term', options: { filter: 'benchmark project', mode: 'regex', archived: false } },
    { name: 'tag', options: { filter: '#work', archived: false } },
    { name: 'archived', options: { archived: true } },
    { name: 'single-keyword-text', options: { filter: 'benchmark', mode: 'text', archived: false } },
    { name: 'multi-term-text', options: { filter: 'benchmark project', mode: 'text', archived: false } },
    { name: 'stemming-regex', options: { filter: 'writes', mode: 'regex', archived: false } },
    { name: 'stemming-text', options: { filter: 'writes', mode: 'text', archived: false } },
    { name: 'tag-and-keyword-text', options: { filter: '#work benchmark', mode: 'text', archived: false } }
];

function parseCount(name, fallback) {
    var prefix = '--' + name + '=';
    var argument = process.argv.slice(2).find(function (value) { return value.startsWith(prefix); });
    var value = argument ? Number(argument.slice(prefix.length)) : fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
    return value;
}

function parseOptionalCount(name) {
    var prefix = '--' + name + '=';
    var argument = process.argv.slice(2).find(function (value) { return value.startsWith(prefix); });
    if (!argument) return null;
    var value = Number(argument.slice(prefix.length));
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
    return value;
}

function fixture(size, ownerId) {
    var timestamp = 1700000000000;
    return Array.from({ length: size }, function (unused, index) {
        var benchmark = index % 10 === 0;
        var stemming = index % 15 === 0;
        var content = 'ordinary personal note ' + index;
        if (benchmark) {
            content = 'benchmark project 基准 note ' + index + ' #work';
        } else if (stemming) {
            content = 'writing documentation and notes about software ' + index;
        }
        return {
            ownerId: ownerId,
            content: content,
            tags: [index % 5 === 0 ? 'work' : 'personal'],
            archived: index % 20 === 0,
            sticky: index % 2 === 0,
            public: false,
            shared: false,
            attachments: [],
            externalContent: [],
            createdAt: timestamp + index,
            modifiedAt: timestamp + index
        };
    });
}

function percentile(sorted, value) {
    return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}

function latency(durations) {
    return {
        p50: round(percentile(durations, 0.50)),
        p95: round(percentile(durations, 0.95)),
        average: round(durations.reduce(function (total, duration) { return total + duration; }, 0) / durations.length)
    };
}

function mongoQuery(ownerId, query) {
    return Object.keys(query).length ? { $and: [{ ownerId: ownerId }, query] } : { ownerId: ownerId };
}

async function runApplicationScenario(ownerId, scenario, limit) {
    return thingService.getAll(ownerId, search.buildQuery(scenario.options), 0, limit);
}

async function benchmarkScenario(db, ownerId, scenario, warmupRuns, repetitions, limit) {
    var warmup;
    for (warmup = 0; warmup < warmupRuns; warmup++) {
        await runApplicationScenario(ownerId, scenario, limit);
    }

    var durations = [];
    var result;
    for (var repetition = 0; repetition < repetitions; repetition++) {
        var started = process.hrtime.bigint();
        result = await runApplicationScenario(ownerId, scenario, limit);
        durations.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    durations.sort(function (left, right) { return left - right; });

    var query = search.buildQuery(scenario.options);
    var cursor = db.collection('things').find(mongoQuery(ownerId, query));
    if (search.queryHasText(query)) {
        cursor = cursor.project({ score: { $meta: 'textScore' } })
            .sort({ sticky: -1, score: { $meta: 'textScore' }, modifiedAt: -1, _id: -1 });
    } else {
        cursor = cursor.sort({ sticky: -1, modifiedAt: -1, _id: -1 });
    }
    var explanation = await cursor.limit(limit).explain('executionStats');
    var stats = explanation.executionStats;

    return {
        name: scenario.name,
        options: scenario.options,
        query: query,
        documentsReturned: result.length,
        scores: result.map(function (item) { return item.score; }).filter(function (s) { return s !== undefined; }),
        latencyMs: latency(durations),
        mongo: {
            nReturned: stats.nReturned,
            executionTimeMillis: stats.executionTimeMillis,
            totalDocsExamined: stats.totalDocsExamined,
            totalKeysExamined: stats.totalKeysExamined
        }
    };
}

async function benchmarkDataset(db, options) {
    options = options || {};
    var size = options.size;
    var ownerId = options.ownerId;
    var warmupRuns = options.warmupRuns;
    var repetitions = options.repetitions;
    var limit = options.limit || 10;
    var scenarios = options.scenarios || SCENARIOS;
    if (!Number.isInteger(size) || size < 1) throw new Error('size must be a positive integer');
    if (typeof ownerId !== 'string' || !ownerId) throw new Error('ownerId is required');
    if (!Number.isInteger(warmupRuns) || warmupRuns < 1) throw new Error('warmupRuns must be a positive integer');
    if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('repetitions must be a positive integer');

    var collection = db.collection('things');
    var originalDb = config.db;
    config.db = db;
    try {
        await databaseThings.ensureIndexes();
        await collection.deleteMany({ ownerId: ownerId });
        await collection.insertMany(fixture(size, ownerId));

        var results = [];
        for (var index = 0; index < scenarios.length; index++) {
            results.push(await benchmarkScenario(db, ownerId, scenarios[index], warmupRuns, repetitions, limit));
        }
        return { fixtureSize: size, scenarios: results };
    } finally {
        try {
            await collection.deleteMany({ ownerId: ownerId });
        } finally {
            config.db = originalDb;
            databaseThings.resetCache();
        }
    }
}

async function main() {
    var warmupRuns = parseCount('warmup', 3);
    var repetitions = parseCount('repetitions', 10);
    var customSize = parseOptionalCount('size');
    var sizes = customSize ? [customSize] : [1000, 10000];
    var ownerId = 'vr212-benchmark-' + process.pid + '-' + Date.now();
    var client = await MongoClient.connect(config.databaseUrl);
    try {
        var db = client.db();
        var serverInfo = await db.admin().serverInfo();
        var results = [];
        for (var index = 0; index < sizes.length; index++) {
            results.push(await benchmarkDataset(db, {
                size: sizes[index],
                ownerId: ownerId,
                warmupRuns: warmupRuns,
                repetitions: repetitions
            }));
        }
        var report = {
            environment: {
                node: process.version,
                mongo: serverInfo.version,
                platform: process.platform,
                arch: process.arch,
                cpuCount: os.cpus().length
            },
            benchmark: {
                implementation: 'thing-service getAll with MongoDB executionStats',
                warmupRuns: warmupRuns,
                repetitions: repetitions,
                limit: 10,
                results: results
            }
        };
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    main().catch(function (error) {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = {
    SCENARIOS: SCENARIOS,
    benchmarkDataset: benchmarkDataset,
    fixture: fixture
};
