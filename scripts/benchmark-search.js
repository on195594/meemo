#!/usr/bin/env node

'use strict';

var os = require('os'),
    search = require('../src/services/search-service.js');

function parseCount(name, fallback) {
    var prefix = '--' + name + '=';
    var argument = process.argv.slice(2).find(function (value) { return value.startsWith(prefix); });
    var value = argument ? Number(argument.slice(prefix.length)) : fallback;
    if (!Number.isInteger(value) || value < 1) throw new Error(name + ' must be a positive integer');
    return value;
}

function fixture(size) {
    return Array.from({ length: size }, function (_, index) {
        return {
            content: index % 10 === 0 ? 'benchmark note ' + index : 'ordinary note ' + index,
            tags: [index % 5 === 0 ? 'work' : 'personal'],
            archived: index % 20 === 0,
            sticky: index % 2 === 0
        };
    });
}

function compile(query) {
    if (query.$and) {
        var andMatchers = query.$and.map(compile);
        return function (item) { return andMatchers.every(function (matches) { return matches(item); }); };
    }
    if (query.$or) {
        var orMatchers = query.$or.map(compile);
        return function (item) { return orMatchers.some(function (matches) { return matches(item); }); };
    }
    var key = Object.keys(query)[0];
    var condition = query[key];
    if (condition && condition.$regex !== undefined) {
        var regex = new RegExp(condition.$regex, condition.$options || '');
        return function (item) { return regex.test(item[key] || ''); };
    }
    if (condition && condition.$exists !== undefined) {
        return function (item) { return (item[key] !== undefined) === condition.$exists; };
    }
    return function (item) {
        return Array.isArray(item[key]) ? item[key].indexOf(condition) !== -1 : item[key] === condition;
    };
}

function percentile(sorted, value) {
    return sorted[Math.max(0, Math.ceil(sorted.length * value) - 1)];
}

function benchmark(size, warmupRuns, repetitions, matcher) {
    var items = fixture(size);
    function execute() {
        var matched = 0;
        for (var i = 0; i < items.length; i++) if (matcher(items[i])) matched++;
        return matched;
    }
    for (var warmup = 0; warmup < warmupRuns; warmup++) execute();

    var durations = [];
    var matched;
    for (var repetition = 0; repetition < repetitions; repetition++) {
        var started = process.hrtime.bigint();
        matched = execute();
        durations.push(Number(process.hrtime.bigint() - started) / 1e6);
    }
    durations.sort(function (left, right) { return left - right; });
    var average = durations.reduce(function (total, duration) { return total + duration; }, 0) / durations.length;
    function round(value) { return Math.round(value * 1000) / 1000; }

    return {
        fixtureSize: size,
        p50Ms: round(percentile(durations, 0.50)),
        p95Ms: round(percentile(durations, 0.95)),
        avgMs: round(average),
        executionStats: {
            documentsExaminedPerRun: size,
            documentsMatchedPerRun: matched,
            totalDocumentsExamined: size * repetitions
        }
    };
}

function main() {
    var warmupRuns = parseCount('warmup', 3);
    var repetitions = parseCount('repetitions', 10);
    var query = search.buildQuery({ filter: 'benchmark #work', archived: false });
    var matcher = compile(query);
    var sizes = [1000, 10000, 50000];
    var report = {
        environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpuCount: os.cpus().length
        },
        benchmark: {
            implementation: 'in-process deterministic query-policy evaluator',
            warmupRuns: warmupRuns,
            repetitions: repetitions,
            query: query,
            results: sizes.map(function (size) { return benchmark(size, warmupRuns, repetitions, matcher); })
        }
    };
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

if (require.main === module) main();

module.exports = { benchmark: benchmark, compile: compile, fixture: fixture };
