#!/usr/bin/env node

'use strict';

var fs = require('fs'),
    files = fs.promises,
    path = require('path'),
    MongoClient = require('mongodb').MongoClient,
    thingService = require('../src/services/thing-service.js'),
    thingDatabase = require('../src/database/things.js'),
    dataMigration = require('./migrate-data-to-v2.js'),
    preflight = require('./preflight-legacy-retirement.js');

function nextArgument(args, index, name) {
    var value = args[index + 1];
    if (!value || value.indexOf('--') === 0) throw new Error(name + ' requires a value');
    return value;
}

function parseArgs(argv, env) {
    var args = argv || process.argv.slice(2);
    env = env || process.env;
    var options = {
        usersFile: env.USERS_FILE,
        authUserSource: env.AUTH_USER_SOURCE,
        environment: env.DEPLOYMENT_ENV || env.NODE_ENV,
        attachmentDir: env.ATTACHMENT_DIR
    };
    for (var index = 0; index < args.length; index++) {
        var arg = args[index];
        if (arg === '--users-file') options.usersFile = nextArgument(args, index++, arg);
        else if (arg === '--owner-map') options.ownerMapPath = nextArgument(args, index++, arg);
        else if (arg === '--expected-source') options.expectedSourceFile = nextArgument(args, index++, arg);
        else if (arg === '--credentials-file') options.credentialsFile = nextArgument(args, index++, arg);
        else if (arg === '--origin') options.origin = nextArgument(args, index++, arg);
        else if (arg === '--attachment-dir') options.attachmentDir = nextArgument(args, index++, arg);
        else if (arg === '--expect-environment') options.expectedEnvironment = nextArgument(args, index++, arg);
        else if (arg === '--expect-database') options.expectedDatabase = nextArgument(args, index++, arg);
        else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error('Unknown argument: ' + arg);
    }
    return options;
}

function requireOptions(options) {
    [
        'usersFile', 'expectedSourceFile', 'credentialsFile', 'origin',
        'attachmentDir', 'environment', 'expectedEnvironment', 'expectedDatabase'
    ].forEach(function (name) {
        if (typeof options[name] !== 'string' || !options[name]) {
            throw new Error('Explicit verifier option is required: ' + name);
        }
    });
    if (options.authUserSource !== 'mongo') throw new Error('AUTH_USER_SOURCE must be mongo');
    var origin = new URL(options.origin);
    if (origin.protocol !== 'https:' && origin.hostname !== '127.0.0.1' && origin.hostname !== 'localhost') {
        throw new Error('Verifier origin must use HTTPS except on loopback');
    }
}

function requireMode0600(filePath) {
    var resolved = path.resolve(filePath);
    var stat = fs.statSync(resolved);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
        throw new Error('Credential-bearing files must be regular files with mode 0600');
    }
    return resolved;
}

function readCredentials(filePath) {
    var resolved = requireMode0600(filePath);
    var credentials = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    var keys = Object.keys(credentials || {}).sort();
    if (JSON.stringify(keys) !== JSON.stringify(['mongoUrl', 'password', 'thingId', 'username'])) {
        throw new Error('Credentials file has invalid fields');
    }
    if (typeof credentials.username !== 'string' || !credentials.username ||
            typeof credentials.password !== 'string' || !credentials.password ||
            typeof credentials.mongoUrl !== 'string' || !credentials.mongoUrl ||
            typeof credentials.thingId !== 'string' || !/^[a-f0-9]{24}$/.test(credentials.thingId)) {
        throw new Error('Credentials file is invalid');
    }
    return credentials;
}

function verifySourceAuthority(options) {
    return new Promise(function (resolve, reject) {
        dataMigration.verifySourceAuthority(options, function (error, result) {
            if (error) return reject(error);
            resolve(result);
        });
    });
}

function exactTagUsage(things) {
    var expected = new Map();
    things.forEach(function (thing) {
        var owner = expected.get(thing.ownerId) || new Map();
        thingService.extractTags(thing.content).forEach(function (name) {
            owner.set(name, (owner.get(name) || 0) + 1);
        });
        expected.set(thing.ownerId, owner);
    });
    return expected;
}

async function inspectBusinessData(db, attachmentDir) {
    var results = await Promise.all([
        db.collection('users').find({}).toArray(),
        db.collection('things').find({}).toArray(),
        db.collection('tags').find({}).toArray(),
        db.collection('settings').find({}).toArray(),
        db.collection('sessions').countDocuments({})
    ]);
    var users = results[0];
    var things = results[1];
    var tags = results[2];
    var settings = results[3];
    if (results[4] !== 0) throw new Error('Session revocation requirement is not satisfied');
    if (!users.length || !things.length) throw new Error('Business corpus is unexpectedly empty');

    var usernames = new Map();
    users.forEach(function (user) {
        var ownerId = user._id && String(user._id);
        if (!ownerId || path.basename(ownerId) !== ownerId ||
                typeof user.username !== 'string' || path.basename(user.username) !== user.username ||
                typeof user.usernameNorm !== 'string' || typeof user.passwordHash !== 'string') {
            throw new Error('User schema invariant failed');
        }
        usernames.set(ownerId, user.username);
    });
    things.forEach(function (thing) {
        if (!usernames.has(thing.ownerId) || typeof thing.content !== 'string' ||
                !Array.isArray(thing.tags) || !Array.isArray(thing.attachments) ||
                JSON.stringify(thing.tags) !== JSON.stringify(thingService.extractTags(thing.content))) {
            throw new Error('Thing owner or schema invariant failed');
        }
    });
    settings.forEach(function (setting) {
        if (!usernames.has(setting.ownerId) || !setting.value || typeof setting.value !== 'object' ||
                Array.isArray(setting.value)) throw new Error('Settings owner or schema invariant failed');
    });

    var expected = exactTagUsage(things);
    var seenTags = new Set();
    tags.forEach(function (tag) {
        var identity = JSON.stringify([tag.ownerId, tag.name]);
        var ownerTags = expected.get(tag.ownerId);
        if (!usernames.has(tag.ownerId) || typeof tag.name !== 'string' ||
                !Number.isSafeInteger(tag.usage) || !ownerTags ||
                ownerTags.get(tag.name) !== tag.usage || seenTags.has(identity)) {
            throw new Error('Exact tag reconciliation invariant failed');
        }
        seenTags.add(identity);
    });
    expected.forEach(function (ownerTags, ownerId) {
        ownerTags.forEach(function (usage, name) {
            if (!seenTags.has(JSON.stringify([ownerId, name]))) {
                throw new Error('Exact tag reconciliation invariant failed');
            }
        });
    });

    for (var thing of things) {
        for (var attachment of thing.attachments) {
            var identifier = typeof attachment === 'string' ? attachment : attachment && attachment.identifier;
            if (typeof identifier !== 'string' || path.basename(identifier) !== identifier ||
                    identifier === '.' || identifier === '..') {
                throw new Error('Attachment reference invariant failed');
            }
            var stablePath = path.join(attachmentDir, thing.ownerId, identifier);
            var legacyPath = path.join(attachmentDir, usernames.get(thing.ownerId), identifier);
            var stat;
            try {
                stat = await files.lstat(stablePath);
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
                stat = await files.lstat(legacyPath);
            }
            if (!stat.isFile() || stat.isSymbolicLink()) {
                throw new Error('Attachment reference invariant failed');
            }
        }
    }
    return { users: users.length, things: things.length, tags: tags.length, settings: settings.length };
}

async function requestJson(fetchImpl, origin, route, options) {
    var response = await fetchImpl(new URL(route, origin), options);
    var body = await response.json().catch(function () { return null; });
    if (!response.ok || !body) throw new Error('Authenticated readback request failed');
    return { response: response, body: body };
}

async function authenticatedReadback(options, credentials) {
    var fetchImpl = options.fetch || fetch;
    var login = await requestJson(fetchImpl, options.origin, '/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: credentials.username, password: credentials.password })
    });
    var cookie = login.response.headers.get('set-cookie');
    if (!cookie) throw new Error('Authenticated readback did not establish a session');
    cookie = cookie.split(';')[0];
    try {
        var profile = await requestJson(
            fetchImpl, options.origin, '/api/profile', { headers: { cookie: cookie } }
        );
        if (!profile.body.user || typeof profile.body.user.username !== 'string' ||
                profile.body.user.username.toLowerCase() !== credentials.username.toLowerCase()) {
            throw new Error('Authenticated profile readback invariant failed');
        }
        var thing = await requestJson(
            fetchImpl, options.origin, '/api/things/' + credentials.thingId,
            { headers: { cookie: cookie } }
        );
        if (!thing.body.thing || thing.body.thing._id !== credentials.thingId) {
            throw new Error('Protected Thing readback invariant failed');
        }
    } finally {
        await requestJson(fetchImpl, options.origin, '/api/logout', {
            method: 'POST', headers: { cookie: cookie }
        });
    }
}

async function run(options) {
    options = options || {};
    requireOptions(options);
    var credentials = readCredentials(options.credentialsFile);
    requireMode0600(options.usersFile);
    var client = new MongoClient(credentials.mongoUrl);
    try {
        var db = client.db();
        if (db.databaseName !== options.expectedDatabase ||
                options.environment !== options.expectedEnvironment) {
            throw new Error('Environment or database binding failed');
        }
        await client.connect();
        await thingDatabase.requireWriteFreeze(db);
        await verifySourceAuthority({
            db: db,
            expectedDatabase: options.expectedDatabase,
            ownerMapPath: options.ownerMapPath,
            expectedSourceFile: options.expectedSourceFile
        });
        var retirement = await preflight.run({
            db: db,
            mongoUrl: credentials.mongoUrl,
            usersFile: options.usersFile,
            usersFileBound: true,
            authUserSource: options.authUserSource,
            environment: options.environment,
            expectedEnvironment: options.expectedEnvironment,
            expectedDatabase: options.expectedDatabase,
            ownerMapPath: options.ownerMapPath
        });
        var nonDataChecksSafe = Object.keys(retirement.checks).every(function (name) {
            return name === 'data' || retirement.checks[name].safe;
        });
        var nonTagMismatch = retirement.dataMismatches.some(function (mismatch) {
            return mismatch.entity !== 'tags';
        });
        if (!nonDataChecksSafe || nonTagMismatch) {
            throw new Error('Migration ownership or count invariants failed');
        }
        var counts = await inspectBusinessData(db, path.resolve(options.attachmentDir));
        await authenticatedReadback(options, credentials);
        await thingDatabase.requireWriteFreeze(db);
        return { safe: true, counts: counts };
    } finally {
        await client.close();
    }
}

async function main() {
    try {
        var options = parseArgs();
        if (options.help) {
            console.log('Usage: node scripts/verify-production-readiness.js --users-file <path> --expected-source <path> --credentials-file <0600-json> --origin <url> --attachment-dir <path> --expect-environment <name> --expect-database <name> [--owner-map <path>]');
            return;
        }
        var report = await run(options);
        console.log('READINESS PASS users=' + report.counts.users +
            ' things=' + report.counts.things + ' tags=' + report.counts.tags +
            ' settings=' + report.counts.settings);
    } catch (error) {
        console.log('READINESS FAIL');
        process.exitCode = 1;
    }
}

module.exports = {
    parseArgs: parseArgs,
    requireMode0600: requireMode0600,
    readCredentials: readCredentials,
    exactTagUsage: exactTagUsage,
    inspectBusinessData: inspectBusinessData,
    authenticatedReadback: authenticatedReadback,
    run: run
};

if (require.main === module) main();
