#!/usr/bin/env node

/* jslint node:true */

'use strict';

var crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    mongodb = require('mongodb'),
    MongoClient = mongodb.MongoClient,
    ObjectId = mongodb.ObjectId,
    EJSON = mongodb.BSON.EJSON,
    ownerMaps = require('./owner-map');

var USER_MIGRATION_ID = 'users-file-to-mongo';
var USER_FIELDS = [
    'username', 'usernameNorm', 'displayName', 'email',
    'passwordHash', 'status', 'createdAt'
];

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
        expectedDatabase: env.EXPECTED_DATABASE,
        ownerMapPath: null
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
        } else if (arg === '--owner-map' && args[index + 1]) {
            options.ownerMapPath = args[++index];
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

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (!value || typeof value !== 'object') return value;
    var result = {};
    Object.keys(value).sort().forEach(function (key) {
        result[key] = stableValue(value[key]);
    });
    return result;
}

function stableJson(value) {
    return JSON.stringify(stableValue(value));
}

function stableDigest(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function byteDigest(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
        stableJson(Object.keys(value).sort()) === stableJson(expected.slice().sort());
}

function sanitizedTargetIdentity(mongoUrl) {
    if (typeof mongoUrl !== 'string' || !mongoUrl) return null;
    try {
        var client = new MongoClient(mongoUrl);
        var hosts = (client.options.hosts || []).map(function (host) { return String(host); });
        if (client.options.srvHost) hosts.push(client.options.srvHost);
        hosts.sort();
        return { database: client.options.dbName, hosts: hosts };
    } catch (ignore) {
        return null;
    }
}

function sourceIdentityRecord(key, user, createdAt, usernameToId) {
    if (!user || typeof user !== 'object') return null;
    var username = user.username || key;
    if (typeof username !== 'string' || !username || typeof user.passwordHash !== 'string') return null;
    return {
        _id: usernameToId && ObjectId.isValid(usernameToId[username.toLowerCase()]) ?
            new ObjectId(usernameToId[username.toLowerCase()]) : null,
        username: username,
        usernameNorm: username.toLowerCase(),
        displayName: user.displayName || username,
        email: user.email || '',
        passwordHash: user.passwordHash,
        status: 'active',
        createdAt: typeof user.createdAt === 'number' ? user.createdAt : createdAt
    };
}

function mongoIdentityRecord(user) {
    var record = { _id: user._id };
    USER_FIELDS.forEach(function (field) { record[field] = user[field]; });
    return record;
}

function inspectIdentityManifest(fileUsers, mongoUsers, migrationEvidence) {
    var sourceKeys = Object.keys(fileUsers);
    var sourceRecords = sourceKeys.map(function (key) {
        var manifest = migrationEvidence && migrationEvidence.manifest;
        return sourceIdentityRecord(
            key, fileUsers[key], manifest && manifest.transformationTimestamp,
            manifest && manifest.usernameToId
        );
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

function inspectUsersMigration(evidence, fileUsers, mongoUsers, usersFile, mongoUrl) {
    var manifest = evidence && evidence.manifest;
    var sourceRaw;
    var sourcePath;
    try {
        sourcePath = fs.realpathSync(usersFile);
        sourceRaw = fs.readFileSync(sourcePath);
    } catch (ignore) {
        sourceRaw = null;
        sourcePath = null;
    }
    var usernameToId = manifest && manifest.usernameToId;
    var sourceRecords = Object.keys(fileUsers).sort().map(function (key) {
        return sourceIdentityRecord(
            key, fileUsers[key], manifest && manifest.transformationTimestamp, usernameToId
        );
    }).filter(Boolean).sort(function (left, right) {
        return left.usernameNorm < right.usernameNorm ? -1 :
            (left.usernameNorm > right.usernameNorm ? 1 : 0);
    });
    var transformedRecords = sourceRecords.map(function (record) {
        var result = { _id: String(record._id) };
        USER_FIELDS.forEach(function (field) { result[field] = record[field]; });
        return result;
    });
    var expectedManifest = manifest && {
        version: 1,
        migration: USER_MIGRATION_ID,
        runId: manifest.runId,
        source: {
            identity: sourcePath,
            byteCount: sourceRaw === null ? null : sourceRaw.length,
            byteDigest: sourceRaw === null ? null : byteDigest(sourceRaw),
            canonicalDigest: stableDigest(fileUsers),
            count: Object.keys(fileUsers).length,
        },
        transformationTimestamp: manifest.transformationTimestamp,
        target: sanitizedTargetIdentity(mongoUrl),
        transformed: {
            count: transformedRecords.length,
            digest: stableDigest(transformedRecords)
        },
        usernameToId: usernameToId
    };
    var manifestValid = exactKeys(manifest, [
        'version', 'migration', 'runId', 'source', 'transformationTimestamp',
        'target', 'transformed', 'usernameToId', 'manifestDigest'
    ]) && exactKeys(manifest.source, [
        'identity', 'byteCount', 'byteDigest', 'canonicalDigest', 'count'
    ]) &&
        exactKeys(manifest.transformed, ['count', 'digest']) &&
        exactKeys(manifest.target, ['database', 'hosts']) &&
        exactKeys(manifest.usernameToId, Object.keys(fileUsers).map(function (key) {
            var user = fileUsers[key];
            return (user && user.username || key).toLowerCase();
        })) && stableJson(manifest) === stableJson(Object.assign({}, expectedManifest, {
            manifestDigest: stableDigest(expectedManifest)
        }));
    var targetRecords = mongoUsers.slice().sort(function (left, right) {
        return left.usernameNorm < right.usernameNorm ? -1 :
            (left.usernameNorm > right.usernameNorm ? 1 : 0);
    }).map(function (record) {
        var result = { _id: String(record._id) };
        USER_FIELDS.forEach(function (field) { result[field] = record[field]; });
        return result;
    });
    var targetValid = !!manifest && targetRecords.length === manifest.transformed.count &&
        stableDigest(targetRecords) === manifest.transformed.digest;
    var safe = !!evidence && evidence._id === USER_MIGRATION_ID &&
        evidence.stateVersion === 1 && evidence.phase === 'applied' && manifestValid && targetValid &&
        evidence.runId === manifest.runId && evidence.manifestDigest === manifest.manifestDigest &&
        evidence.nextIndex === manifest.transformed.count &&
        Number.isSafeInteger(evidence.startedAt) && Number.isSafeInteger(evidence.plannedAppliedAt) &&
        evidence.appliedAt === evidence.plannedAppliedAt;
    return {
        phase: evidence && evidence.phase || null,
        sourceCount: manifest && manifest.source && manifest.source.count,
        transformedCount: manifest && manifest.transformed && manifest.transformed.count,
        safe: safe
    };
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

async function inspectForbiddenLegacyCollections(db, collectionPrefix) {
    var prefix = collectionPrefix || '';
    var pattern = /^((.*_)?tokens)$/;
    var collections = await db.listCollections().toArray();
    var forbidden = [];

    for (var index = 0; index < collections.length; index++) {
        var name = collections[index].name;
        if (prefix && name.indexOf(prefix) !== 0) continue;
        var unprefixed = prefix ? name.slice(prefix.length) : name;
        if (!pattern.test(unprefixed)) continue;
        forbidden.push({
            name: name,
            count: await db.collection(name).countDocuments({})
        });
    }
    return forbidden;
}

function inspectOwners(legacyCollections, mongoIndex, fileMappings, ownerMap, usernameToId) {
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
        var mapped = ownerMaps.has(ownerMap, prefix);
        var identifier = mapped ? ownerMap[prefix] : prefix;
        var expectedId = mapped && usernameToId && usernameToId[normalized(identifier)];
        var matches = mapped && !expectedId ? [] : matchingUsers(mongoIndex, [identifier]);
        if (matches.length === 0) unmatched.push(prefix);
        else if (matches.length > 1) {
            collisions.push({ prefix: prefix, mongoUserIds: matches.map(userIdentity) });
        } else if (!authoritativeOwners[userIdentity(matches[0])] ||
                (mapped && String(expectedId) !== userIdentity(matches[0]))) {
            unmatched.push(prefix);
        } else {
            mappings.push({ prefix: prefix, mongoUserId: userIdentity(matches[0]) });
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

function modifiedAfterMigration(type, document, startedAt) {
    if (typeof startedAt !== 'number') return false;
    var timestamp = type === 'settings' ? document.modifiedAt :
        document.modifiedAt === undefined ? document.createdAt : document.modifiedAt;
    return typeof timestamp === 'number' && timestamp > startedAt;
}

async function inspectData(db, collectionPrefix, legacyCollections, owners, authoritativeUsers, migration) {
    var ownerByPrefix = Object.create(null);
    var groups = new Map();
    var mismatches = [];
    var sourceRecords = [];
    var targetRecords = [];
    var matchedCount = 0;

    owners.mappings.forEach(function (mapping) {
        ownerByPrefix[mapping.prefix] = mapping.mongoUserId;
    });
    authoritativeUsers.forEach(function (mapping) {
        ['things', 'tags', 'settings'].forEach(function (type) {
            var groupKey = canonicalJson([mapping.mongoUserId, type]);
            if (!groups.has(groupKey)) {
                groups.set(groupKey, {
                    ownerId: mapping.mongoUserId, type: type, entries: []
                });
            }
        });
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
            if (!ownerId) {
                sourceRecords.push({
                    ownerId: entry.ownerId,
                    entity: entry.type,
                    id: identity.value,
                    fields: sourceFields
                });
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
        if (group.type === 'settings' && group.entries.length > 1) {
            var expectedSettings = canonicalJson(canonicalDataFields(
                'settings', group.entries[0].document, true, migration && migration.startedAt
            ));
            for (var settingsIndex = 1; settingsIndex < group.entries.length; settingsIndex++) {
                if (canonicalJson(canonicalDataFields(
                    'settings', group.entries[settingsIndex].document, true,
                    migration && migration.startedAt
                )) !== expectedSettings) {
                    addDataMismatch(mismatches, group.entries[settingsIndex], 'value');
                }
            }
            group.entries = [group.entries[0]];
        }

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
                if (group.type !== 'things') {
                    addDataMismatch(mismatches, entry, 'identity');
                    return;
                }
                var existing = sourceIdentities.get(key);
                var existingFields = canonicalDataFields(
                    existing.type, existing.document, true, migration && migration.startedAt
                );
                var duplicateFields = canonicalDataFields(
                    entry.type, entry.document, true, migration && migration.startedAt
                );
                if (canonicalJson(existingFields) !== canonicalJson(duplicateFields)) {
                    addDataMismatch(mismatches, entry, 'identity');
                }
                return;
            }
            sourceIdentities.set(key, entry);

            var target = targetByIdentity.get(key);
            if (!target) {
                addDataMismatch(mismatches, entry, entry.identity.field);
                return;
            }
            if (modifiedAfterMigration(group.type, target, migration && migration.startedAt)) return;

            var sourceFields = canonicalDataFields(
                entry.type, entry.document, true, migration && migration.startedAt
            );
            var targetFields = canonicalDataFields(
                entry.type, target, false, migration && migration.startedAt
            );
            sourceRecords.push({
                ownerId: entry.ownerId,
                entity: entry.type,
                id: entry.identity.value,
                fields: sourceFields
            });
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

        targetByIdentity.forEach(function (target, key) {
            if (!sourceIdentities.has(key) &&
                    !modifiedAfterMigration(group.type, target, migration && migration.startedAt)) {
                addDataMismatch(mismatches, {
                    ownerId: group.ownerId,
                    collection: (collectionPrefix || '') + group.type,
                    type: group.type,
                    identity: dataIdentity(group.type, target)
                }, dataIdentity(group.type, target).field);
            }
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
    var ownerMapInfo = ownerMaps.load(options.ownerMapPath);
    var db = options.db;
    var close = function () { return Promise.resolve(); };

    if (!db) {
        if (!options.mongoUrl) throw new Error('MONGODB_URL or --mongo-url must be explicitly bound');
        var client;
        try {
            client = await MongoClient.connect(options.mongoUrl);
        } catch (ignore) {
            throw new Error('Failed to connect to target MongoDB');
        }
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
        var usersMigrationEvidence = await db.collection(names.migrations)
            .findOne({ _id: USER_MIGRATION_ID });
        var usersMigration = inspectUsersMigration(
            usersMigrationEvidence, fileResult.users, mongoUsers,
            options.usersFile, options.mongoUrl
        );
        var mongoIndex = buildMongoIdentityIndex(mongoUsers);
        var identities = inspectFileIdentities(fileResult.users, mongoIndex);
        var identityManifest = inspectIdentityManifest(
            fileResult.users, mongoUsers, usersMigrationEvidence
        );
        var legacyCollections = await inspectLegacyCollections(db, options.collectionPrefix);
        var forbiddenCollections = await inspectForbiddenLegacyCollections(db, options.collectionPrefix);
        var legacyPrefixes = legacyCollections.reduce(function (prefixes, entry) {
            if (prefixes.indexOf(entry.prefix) === -1) prefixes.push(entry.prefix);
            return prefixes;
        }, []);
        var ownerMapSafe = true;
        try {
            ownerMaps.validatePrefixes(ownerMapInfo.map, legacyPrefixes);
        } catch (ignore) {
            ownerMapSafe = false;
        }
        var manifestUsernameToId = usersMigrationEvidence && usersMigrationEvidence.manifest &&
            usersMigrationEvidence.manifest.usernameToId || Object.create(null);
        var owners = inspectOwners(
            legacyCollections, mongoIndex, identities.mappings,
            ownerMapInfo.map, manifestUsernameToId
        );
        var migration = await db.collection(names.migrations).findOne({ _id: 'schema-v2' });
        var data = await inspectData(
            db, options.collectionPrefix, legacyCollections, owners,
            identities.mappings, migration
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
            usersMigration: usersMigration,
            identities: Object.assign({}, identityManifest, {
                safe: identityManifest.sourceCount > 0 &&
                    identityManifest.validSourceCount === identityManifest.sourceCount &&
                    identityManifest.sourceCount === identityManifest.mongoCount &&
                    identityManifest.sourceDigest === identityManifest.mongoDigest &&
                    identities.collisions.length === 0 && identities.unmatched.length === 0
            }),
            ownerMap: {
                count: ownerMapInfo.count,
                digest: ownerMapInfo.digest,
                safe: ownerMapSafe
            },
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
            forbiddenCollections: {
                found: forbiddenCollections.map(function (entry) { return entry.name; }),
                count: forbiddenCollections.length,
                safe: forbiddenCollections.length === 0
            },
            migration: {
                phase: migration && migration.phase || null,
                sourceVersion: migration && migration.sourceVersion,
                targetVersion: migration && migration.targetVersion,
                safe: !!migration && migration.phase === 'complete' &&
                    migration.sourceVersion === 1 && migration.targetVersion === 2 &&
                    migration.ownerMapDigest === ownerMapInfo.digest
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
            forbiddenCollections: forbiddenCollections,
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
            console.log('Usage: node scripts/preflight-legacy-retirement.js --mongo-url <url> --users-file <path> --owner-map <path> --expect-environment <name> --expect-database <name>');
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
