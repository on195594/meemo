#!/usr/bin/env node

/* jslint node:true */

'use strict';

var fs = require('fs'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient;

function parseArgs(argv, env) {
    var args = argv || process.argv.slice(2);
    env = env || process.env;
    var options = {
        mongoUrl: env.MONGODB_URL,
        usersFile: env.USERS_FILE,
        usersFileBound: !!env.USERS_FILE,
        authUserSource: env.AUTH_USER_SOURCE,
        environment: env.DEPLOYMENT_ENV || env.NODE_ENV,
        expectedEnvironment: env.EXPECTED_ENVIRONMENT,
        expectedDatabase: env.EXPECTED_DATABASE
    };

    for (var index = 0; index < args.length; index++) {
        var arg = args[index];
        if (arg === '--mongo-url' && args[index + 1]) options.mongoUrl = args[++index];
        else if (arg === '--users-file' && args[index + 1]) {
            options.usersFile = args[++index];
            options.usersFileBound = true;
        } else if (arg === '--expect-environment' && args[index + 1]) {
            options.expectedEnvironment = args[++index];
        } else if (arg === '--expect-database' && args[index + 1]) {
            options.expectedDatabase = args[++index];
        } else if (arg === '--help' || arg === '-h') options.help = true;
        else throw new Error('Unknown or incomplete argument: ' + arg);
    }
    return options;
}

function normalized(value) {
    return typeof value === 'string' ? value.toLowerCase() : null;
}

function addAlias(index, alias, user) {
    alias = normalized(alias);
    if (!alias) return;
    if (!index[alias]) index[alias] = [];
    if (index[alias].indexOf(user) === -1) index[alias].push(user);
}

function userIdentity(user) {
    return String(user._id);
}

function buildMongoIdentityIndex(mongoUsers) {
    var index = Object.create(null);
    mongoUsers.forEach(function (user) {
        addAlias(index, user._id && String(user._id), user);
        addAlias(index, user.username, user);
        addAlias(index, user.usernameNorm, user);
    });
    return index;
}

function matchingUsers(index, aliases) {
    var matches = [];
    aliases.forEach(function (alias) {
        alias = normalized(alias);
        (alias && index[alias] || []).forEach(function (user) {
            if (matches.indexOf(user) === -1) matches.push(user);
        });
    });
    return matches;
}

function readUsersFile(filePath, bound) {
    var result = { path: filePath ? path.resolve(filePath) : null, bound: !!bound, exists: false, valid: false };
    if (!result.bound || !result.path) return { report: result, users: {} };
    result.exists = fs.existsSync(result.path);
    if (!result.exists) return { report: result, users: {} };

    try {
        var users = JSON.parse(fs.readFileSync(result.path, 'utf8'));
        if (!users || typeof users !== 'object' || Array.isArray(users)) {
            result.error = 'USERS_FILE must contain a JSON object';
            return { report: result, users: {} };
        }
        result.valid = true;
        result.count = Object.keys(users).length;
        return { report: result, users: users };
    } catch (error) {
        result.error = error.message;
        return { report: result, users: {} };
    }
}

function inspectFileIdentities(fileUsers, mongoIndex) {
    var aliases = Object.create(null);
    var collisions = [];
    var unmatched = [];
    var mappings = [];
    var mongoOwners = Object.create(null);

    Object.keys(fileUsers).forEach(function (key) {
        var fileUser = fileUsers[key];
        if (!fileUser || typeof fileUser !== 'object') {
            unmatched.push(key);
            return;
        }
        var identityAliases = [key, fileUser.username, fileUser.id].filter(Boolean);
        identityAliases.forEach(function (alias) {
            var norm = normalized(alias);
            if (aliases[norm] && aliases[norm] !== key) {
                collisions.push({ type: 'file-alias', identity: norm, users: [aliases[norm], key] });
            } else aliases[norm] = key;
        });

        var matches = matchingUsers(mongoIndex, identityAliases);
        if (matches.length === 0) unmatched.push(key);
        else if (matches.length > 1) {
            collisions.push({
                type: 'file-to-mongo', identity: key,
                mongoUserIds: matches.map(userIdentity)
            });
        } else {
            var mongoId = userIdentity(matches[0]);
            if (mongoOwners[mongoId] && mongoOwners[mongoId] !== key) {
                collisions.push({ type: 'shared-mongo-owner', mongoUserId: mongoId, users: [mongoOwners[mongoId], key] });
            } else mongoOwners[mongoId] = key;
            mappings.push({ fileIdentity: key, mongoUserId: mongoId, username: matches[0].username });
        }
    });

    return { collisions: collisions, unmatched: unmatched, mappings: mappings };
}

async function inspectLegacyCollections(db, collectionPrefix) {
    var prefix = collectionPrefix || '';
    var suffixPattern = /^(.*)_(things|tags|settings)$/;
    var collections = await db.listCollections().toArray();
    var legacy = [];

    for (var index = 0; index < collections.length; index++) {
        var name = collections[index].name;
        if (prefix && name.indexOf(prefix) !== 0) continue;
        var unprefixed = prefix ? name.slice(prefix.length) : name;
        var match = suffixPattern.exec(unprefixed);
        if (!match) continue;
        legacy.push({
            name: name,
            prefix: match[1],
            type: match[2],
            count: await db.collection(name).countDocuments({})
        });
    }
    return legacy;
}

function inspectOwners(legacyCollections, mongoIndex) {
    var prefixes = [];
    legacyCollections.forEach(function (entry) {
        if (prefixes.indexOf(entry.prefix) === -1) prefixes.push(entry.prefix);
    });

    var mappings = [];
    var unmatched = [];
    var collisions = [];
    prefixes.forEach(function (prefix) {
        var matches = matchingUsers(mongoIndex, [prefix]);
        if (matches.length === 0) unmatched.push(prefix);
        else if (matches.length > 1) {
            collisions.push({ prefix: prefix, mongoUserIds: matches.map(userIdentity) });
        } else {
            mappings.push({ prefix: prefix, mongoUserId: userIdentity(matches[0]), username: matches[0].username });
        }
    });
    return { mappings: mappings, unmatched: unmatched, collisions: collisions };
}

async function run(options) {
    options = options || {};
    var db = options.db;
    var close = function () { return Promise.resolve(); };

    if (!db) {
        if (!options.mongoUrl) throw new Error('MONGODB_URL or --mongo-url must be explicitly bound');
        var client = await MongoClient.connect(options.mongoUrl);
        db = client.db();
        close = function () { return client.close(); };
    }

    try {
        var names = {
            users: (options.collectionPrefix || '') + 'users',
            migrations: (options.collectionPrefix || '') + 'system_migrations'
        };
        var fileResult = readUsersFile(options.usersFile, options.usersFileBound !== undefined ?
            options.usersFileBound : !!options.usersFile);
        var mongoUsers = await db.collection(names.users).find({}).toArray();
        var mongoIndex = buildMongoIdentityIndex(mongoUsers);
        var identities = inspectFileIdentities(fileResult.users, mongoIndex);
        var legacyCollections = await inspectLegacyCollections(db, options.collectionPrefix);
        var owners = inspectOwners(legacyCollections, mongoIndex);
        var migration = await db.collection(names.migrations).findOne({ _id: 'schema-v2' });

        var checks = {
            authUserSource: {
                value: options.authUserSource || null,
                bound: !!options.authUserSource,
                safe: options.authUserSource === 'mongo'
            },
            usersFile: Object.assign({}, fileResult.report, {
                safe: fileResult.report.bound && fileResult.report.exists && fileResult.report.valid
            }),
            identities: {
                safe: identities.collisions.length === 0 && identities.unmatched.length === 0
            },
            owners: {
                safe: owners.collisions.length === 0 && owners.unmatched.length === 0
            },
            migration: {
                phase: migration && migration.phase || null,
                sourceVersion: migration && migration.sourceVersion,
                targetVersion: migration && migration.targetVersion,
                safe: !!migration && migration.phase === 'complete' &&
                    migration.sourceVersion === 1 && migration.targetVersion === 2
            },
            environment: {
                actual: options.environment || null,
                expected: options.expectedEnvironment || null,
                bound: !!options.environment && !!options.expectedEnvironment,
                safe: !!options.environment && !!options.expectedEnvironment &&
                    options.environment === options.expectedEnvironment
            },
            database: {
                actual: db.databaseName || null,
                expected: options.expectedDatabase || null,
                bound: !!db.databaseName && !!options.expectedDatabase,
                safe: !!db.databaseName && !!options.expectedDatabase &&
                    db.databaseName === options.expectedDatabase
            }
        };
        var safe = Object.keys(checks).every(function (key) { return checks[key].safe; });

        return {
            status: safe ? 'SAFE_TO_RETIRE' : 'UNSAFE_TO_RETIRE',
            safe: safe,
            checks: checks,
            legacyCollections: legacyCollections,
            fileUserMappings: identities.mappings,
            identityCollisions: identities.collisions,
            unmatchedFileUsers: identities.unmatched,
            ownerMappings: owners.mappings,
            ownerCollisions: owners.collisions,
            unmatchedOwners: owners.unmatched
        };
    } finally {
        await close();
    }
}

async function main() {
    var options;
    try {
        options = parseArgs();
        if (options.help) {
            console.log('Usage: node scripts/preflight-legacy-retirement.js --mongo-url <url> --users-file <path> --expect-environment <name> --expect-database <name>');
            process.exit(0);
        }
        var report = await run(options);
        console.log(JSON.stringify(report, null, 2));
        console.log(report.status);
        process.exit(report.safe ? 0 : 2);
    } catch (error) {
        console.error('RETIREMENT_PREFLIGHT_ERROR:', error.message);
        process.exit(1);
    }
}

module.exports = { parseArgs: parseArgs, run: run };

if (require.main === module) main();
