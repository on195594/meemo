#!/usr/bin/env node

'use strict';

var mongodb = require('mongodb');
var MongoClient = mongodb.MongoClient;

var USAGE = [
    'Usage: node scripts/migrate-thing-revisions.js [--dry-run | --apply | --verify] --mongo-url <url> --expect-database <name>',
    '',
    'Backfills only missing Thing revisions to 1. Invalid existing revisions always fail.'
].join('\n');

function nextArgument(args, index, name) {
    var value = args[index + 1];
    if (!value || value.indexOf('--') === 0) throw new Error(name + ' requires a value');
    return value;
}

function parseArgs(argv) {
    var args = argv || process.argv.slice(2);
    var options = { mode: null, mongoUrl: null, expectedDatabase: null };
    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--dry-run' || arg === '--apply' || arg === '--verify') {
            if (options.mode) throw new Error('Exactly one migration mode is required');
            options.mode = arg.slice(2);
        } else if (arg === '--mongo-url') {
            options.mongoUrl = nextArgument(args, i, arg);
            i++;
        } else if (arg === '--expect-database') {
            options.expectedDatabase = nextArgument(args, i, arg);
            i++;
        } else if (arg === '--help' || arg === '-h') {
            if (args.length !== 1) throw new Error('--help cannot be combined with other arguments');
            return { mode: 'help' };
        } else {
            throw new Error('Unknown argument: ' + arg);
        }
    }
    if (!options.mode) throw new Error('Exactly one migration mode is required');
    if (!options.mongoUrl) throw new Error('--mongo-url is required');
    if (!options.expectedDatabase) throw new Error('--expect-database is required');
    var target = new URL(options.mongoUrl);
    var actualDatabase = decodeURIComponent(target.pathname.replace(/^\//, ''));
    if (!actualDatabase || actualDatabase !== options.expectedDatabase) {
        throw new Error('MongoDB database does not match --expect-database');
    }
    return options;
}

function isValidRevision(value) {
    return Number.isSafeInteger(value) && value >= 1;
}

async function inspect(db) {
    var cursor = db.collection('things').find({}, { projection: { revision: 1 } });
    var missing = 0;
    var invalid = 0;
    while (await cursor.hasNext()) {
        var document = await cursor.next();
        if (!Object.prototype.hasOwnProperty.call(document, 'revision')) missing++;
        else if (!isValidRevision(document.revision)) invalid++;
    }
    return { missing: missing, invalid: invalid };
}

async function run(options) {
    var client = await MongoClient.connect(options.mongoUrl);
    try {
        var db = client.db(options.expectedDatabase);
        var before = await inspect(db);
        if (before.invalid) throw new Error('Invalid Thing revisions found: ' + before.invalid);
        if (options.mode === 'apply' && before.missing) {
            await db.collection('things').updateMany(
                { revision: { $exists: false } },
                { $set: { revision: 1 } },
                { writeConcern: { w: 'majority', j: true } }
            );
        }
        var after = options.mode === 'apply' ? await inspect(db) : before;
        if ((options.mode === 'apply' || options.mode === 'verify') && after.missing) {
            throw new Error('Thing revision migration is incomplete: ' + after.missing + ' missing');
        }
        return { mode: options.mode, before: before, after: after };
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    try {
        var options = parseArgs();
        if (options.mode === 'help') console.log(USAGE);
        else run(options).then(function (result) {
            console.log(JSON.stringify(result));
        }).catch(function (error) {
            console.error(error.message);
            process.exitCode = 1;
        });
    } catch (error) {
        console.error(error.message);
        console.error(USAGE);
        process.exitCode = 1;
    }
}

module.exports = {
    parseArgs: parseArgs,
    inspect: inspect,
    run: run,
    isValidRevision: isValidRevision
};
