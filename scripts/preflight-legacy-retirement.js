#!/usr/bin/env node

/* jslint node:true */

'use strict';

var crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    mongodb = require('mongodb'),
    MongoClient = mongodb.MongoClient,
    EJSON = mongodb.BSON.EJSON;

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

function sortFields(value) {
    if (Array.isArray(value)) return value.map(sortFields);
    if (!value || typeof value !== 'object') return value;
    if (Object.getPrototypeOf(value) !== Object.prototype &&
            Object.getPrototypeOf(value) !== null) return value;

    var sorted = Object.create(null);
    Object.keys(value).sort().forEach(function (key) {
        sorted[key] = sortFields(value[key]);
    });
    return sorted;
}

function canonicalJson(value) {
    return EJSON.stringify(sortFields(value), { relaxed: false });
}

function recordsDigest(records) {
    var sorted = records.slice().sort(function (left, right) {
        var leftJson = canonicalJson(left);
        var rightJson = canonicalJson(right);
        if (leftJson < rightJson) return -1;
        if (leftJson > rightJson) return 1;
        return 0;
    });
    return crypto.createHash('sha256').update(canonicalJson(sorted)).digest('hex');
}

function sourceIdentityRecord(key, user) {
    if (!user || typeof user !== 'object') return null;
    var username = user.username || key;
    if (typeof username !== 'string' || !username || typeof user.passwordHash !== 'string') return null;
    return {
        username: username,
        usernameNorm: username.toLowerCase(),
        displayName: user.displayName || username,
        email: user.email || '',
        passwordHash: user.passwordHash,
        status: 'active'
    };
}

function mongoIdentityRecord(user) {
    return {
        username: user.username,
        usernameNorm: user.usernameNorm,
        displayName: user.displayName,
        email: user.email,
        passwordHash: user.passwordHash,
        status: user.status
    };
}

function inspectIdentityManifest(fileUsers, mongoUsers) {
    var sourceKeys = Object.keys(fileUsers);
    var sourceRecords = sourceKeys.map(function (key) {
        return sourceIdentityRecord(key, fileUsers[key]);
    }).filter(Boolean);
    var mongoRecords = mongoUsers.map(mongoIdentityRecord);
    return {
        sourceCount: sourceKeys.length,
        mongoCount: mongoUsers.length,
        validSourceCount: sourceRecords.length,
        sourceDigest: recordsDigest(sourceRecords),
        mongoDigest: recordsDigest(mongoRecords)
    };
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

function inspectOwners(legacyCollections, mongoIndex, fileMappings) {
    var prefixes = [];
    var authoritativeOwners = Object.create(null);
    fileMappings.forEach(function (mapping) {
        authoritativeOwners[mapping.mongoUserId] = true;
    });
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
        } else if (!authoritativeOwners[userIdentity(matches[0])]) {
            unmatched.push(prefix);
        } else {
            mappings.push({ prefix: prefix, mongoUserId: userIdentity(matches[0]), username: matches[0].username });
        }
    });
    return { mappings: mappings, unmatched: unmatched, collisions: collisions };
}

var THING_FIELDS = [
    '_id', 'content', 'createdAt', 'modifiedAt', 'attachments',
    'externalContent', 'public', 'shared', 'archived', 'sticky'
];

function canonicalField(document, field, expectedValue) {
    if (arguments.length === 3) return { present: true, value: expectedValue };
    if (!Object.prototype.hasOwnProperty.call(document, field)) return { present: false };
    return { present: true, value: document[field] };
}

function canonicalDataFields(type, document, source, startedAt) {
    if (type === 'things') {
        var thing = {};
        THING_FIELDS.forEach(function (field) {
            if (source && (field === 'public' || field === 'shared' ||
                    field === 'archived' || field === 'sticky')) {
                thing[field] = canonicalField(document, field, !!document[field]);
            } else thing[field] = canonicalField(document, field);
        });
        return thing;
    }
    if (type === 'tags') {
        return {
            name: canonicalField(document, 'name'),
            usage: source ? canonicalField(document, 'usage', document.usage || 1) :
                canonicalField(document, 'usage'),
            createdAt: source ? canonicalField(document, 'createdAt', document.createdAt || startedAt) :
                canonicalField(document, 'createdAt')
        };
    }
    var value = document && typeof document.value === 'object' ?
        document.value : { title: 'Meemo' };
    return {
        value: source ? canonicalField(document, 'value', value) :
            canonicalField(document, 'value')
    };
}

function dataIdentity(type, document) {
    var field = type === 'things' ? '_id' : type === 'tags' ? 'name' : 'type';
    return { field: field, value: canonicalField(document, field) };
}

function addDataMismatch(mismatches, entry, field) {
    mismatches.push({
        ownerId: entry.ownerId,
        legacyCollection: entry.collection,
        entity: entry.type,
        id: String(entry.identity.value.value),
        field: field
    });
}

async function inspectData(db, collectionPrefix, legacyCollections, owners, migration) {
    var ownerByPrefix = Object.create(null);
    var groups = new Map();
    var mismatches = [];
    var sourceRecords = [];
    var targetRecords = [];
    var matchedCount = 0;

    owners.mappings.forEach(function (mapping) {
        ownerByPrefix[mapping.prefix] = mapping.mongoUserId;
    });

    for (var collectionIndex = 0; collectionIndex < legacyCollections.length; collectionIndex++) {
        var collection = legacyCollections[collectionIndex];
        var documents = await db.collection(collection.name).find({}).toArray();
        collection.count = documents.length;
        var ownerId = ownerByPrefix[collection.prefix];

        documents.forEach(function (document) {
            var identity = dataIdentity(collection.type, document);
            var entry = {
                ownerId: ownerId || null,
                collection: collection.name,
                type: collection.type,
                document: document,
                identity: identity
            };
            var sourceFields = canonicalDataFields(
                collection.type, document, true, migration && migration.startedAt
            );
            sourceRecords.push({
                ownerId: entry.ownerId,
                entity: entry.type,
                id: identity.value,
                fields: sourceFields
            });
            if (!ownerId) {
                addDataMismatch(mismatches, entry, 'ownerId');
                return;
            }
            var groupKey = canonicalJson([ownerId, collection.type]);
            if (!groups.has(groupKey)) {
                groups.set(groupKey, { ownerId: ownerId, type: collection.type, entries: [] });
            }
            groups.get(groupKey).entries.push(entry);
        });
    }

    for (var group of groups.values()) {
        var targets = await db.collection((collectionPrefix || '') + group.type)
            .find({ ownerId: group.ownerId }).toArray();
        var targetByIdentity = new Map();
        targets.forEach(function (target) {
            var identity = dataIdentity(group.type, target);
            var key = canonicalJson(identity.value);
            if (targetByIdentity.has(key)) {
                addDataMismatch(mismatches, {
                    ownerId: group.ownerId,
                    collection: (collectionPrefix || '') + group.type,
                    type: group.type,
                    identity: identity
                }, 'identity');
            } else targetByIdentity.set(key, target);
        });

        var sourceIdentities = new Map();
        group.entries.forEach(function (entry) {
            var key = canonicalJson(entry.identity.value);
            if (sourceIdentities.has(key)) {
                addDataMismatch(mismatches, entry, 'identity');
                return;
            }
            sourceIdentities.set(key, true);

            var target = targetByIdentity.get(key);
            if (!target) {
                addDataMismatch(mismatches, entry, entry.identity.field);
                return;
            }

            var sourceFields = canonicalDataFields(
                entry.type, entry.document, true, migration && migration.startedAt
            );
            var targetFields = canonicalDataFields(
                entry.type, target, false, migration && migration.startedAt
            );
            matchedCount++;
            targetRecords.push({
                ownerId: entry.ownerId,
                entity: entry.type,
                id: entry.identity.value,
                fields: targetFields
            });
            Object.keys(sourceFields).forEach(function (field) {
                if (canonicalJson(sourceFields[field]) !== canonicalJson(targetFields[field])) {
                    addDataMismatch(mismatches, entry, field);
                }
            });
        });
    }

    var sourceDigest = recordsDigest(sourceRecords);
    var targetDigest = recordsDigest(targetRecords);
    return {
        sourceCount: sourceRecords.length,
        matchedCount: matchedCount,
        sourceDigest: sourceDigest,
        targetDigest: targetDigest,
        mismatches: mismatches,
        safe: mismatches.length === 0 && sourceRecords.length === matchedCount &&
            sourceDigest === targetDigest
    };
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
        var identityManifest = inspectIdentityManifest(fileResult.users, mongoUsers);
        var legacyCollections = await inspectLegacyCollections(db, options.collectionPrefix);
        var owners = inspectOwners(legacyCollections, mongoIndex, identities.mappings);
        var migration = await db.collection(names.migrations).findOne({ _id: 'schema-v2' });
        var data = await inspectData(
            db, options.collectionPrefix, legacyCollections, owners, migration
        );

        var checks = {
            authUserSource: {
                value: options.authUserSource || null,
                bound: !!options.authUserSource,
                safe: options.authUserSource === 'mongo'
            },
            usersFile: Object.assign({}, fileResult.report, {
                safe: fileResult.report.bound && fileResult.report.exists &&
                    fileResult.report.valid && fileResult.report.count > 0
            }),
            identities: Object.assign({}, identityManifest, {
                safe: identityManifest.sourceCount > 0 &&
                    identityManifest.validSourceCount === identityManifest.sourceCount &&
                    identityManifest.sourceCount === identityManifest.mongoCount &&
                    identityManifest.sourceDigest === identityManifest.mongoDigest &&
                    identities.collisions.length === 0 && identities.unmatched.length === 0
            }),
            owners: {
                safe: owners.collisions.length === 0 && owners.unmatched.length === 0
            },
            data: {
                sourceCount: data.sourceCount,
                matchedCount: data.matchedCount,
                sourceDigest: data.sourceDigest,
                targetDigest: data.targetDigest,
                safe: data.safe
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
            unmatchedOwners: owners.unmatched,
            dataMismatches: data.mismatches
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
        console.log('SAFE_TO_RETIRE=' + report.safe);
        process.exit(report.safe ? 0 : 1);
    } catch (error) {
        console.error('RETIREMENT_PREFLIGHT_ERROR:', error.message);
        console.log('SAFE_TO_RETIRE=false');
        process.exit(1);
    }
}

module.exports = { parseArgs: parseArgs, run: run };

if (require.main === module) main();
