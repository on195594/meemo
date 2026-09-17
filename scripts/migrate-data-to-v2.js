#!/usr/bin/env node

/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    EJSON = require('mongodb').BSON.EJSON,
    async = require('async'),
    crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    ownerMaps = require('./owner-map.js'),
    userMigration = require('./migrate-users-to-mongo.js'),
    config = require('../src/config.js'),
    users = require('../src/users.js');

var MIGRATION_ID = 'schema-v2';
var EXPECTED_SOURCE_VERSION = 2;
var MIGRATION_PHASES = {
    pending: true,
    copying: true,
    copied: true,
    verified: true,
    cutover: true,
    complete: true,
    failed: true
};
var APPLY_PHASES = {
    pending: true,
    copying: true,
    copied: true,
    failed: true
};

function migrationError(phase, user, collection, operation, error) {
    var detail = String(error && error.message ? error.message : error || 'unknown error');
    detail = detail.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, '[REDACTED]');

    var wrapped = new Error(
        'Migration failure: phase=' + phase +
        '; user=' + user +
        '; collection=' + collection +
        '; operation=' + operation +
        '; error=' + detail
    );
    if (error && error.code) wrapped.code = error.code;
    if (error && error.codeName) wrapped.codeName = error.codeName;
    return wrapped;
}

function closeConnection(close, phase, primaryError, callback) {
    mongoOperation(phase, '<all>', '<database>', 'close', function () {
        return close();
    }, function (closeError) {
        callback(primaryError || closeError || null);
    });
}

function mongoOperation(phase, user, collection, operation, invoke, callback) {
    Promise.resolve().then(invoke).then(function (result) {
        callback(null, result);
    }, function (error) {
        callback(migrationError(phase, user, collection, operation, error));
    });
}

function collectionOperation(db, phase, user, collectionName, operation, args, callback) {
    mongoOperation(phase, user, collectionName, operation, function () {
        var collection = db.collection(collectionName);
        return collection[operation].apply(collection, args);
    }, callback);
}

function findDocuments(db, phase, user, collectionName, query, callback) {
    var cursor;

    try {
        cursor = db.collection(collectionName).find(query);
    } catch (error) {
        return callback(migrationError(phase, user, collectionName, 'find', error));
    }

    mongoOperation(phase, user, collectionName, 'toArray', function () {
        return cursor.toArray();
    }, callback);
}

function newMigrationState(ownerMapDigest, sourceEvidenceDigest) {
    return {
        _id: MIGRATION_ID,
        sourceVersion: 1,
        targetVersion: 2,
        ownerMapDigest: ownerMapDigest,
        sourceEvidenceDigest: sourceEvidenceDigest,
        phase: 'pending',
        startedAt: null,
        copiedAt: null,
        verifiedAt: null,
        cutoverAt: null
    };
}

function validateMigrationState(state, ownerMapDigest, sourceEvidenceDigest, phase, callback) {
    if (state.sourceVersion !== 1 || state.targetVersion !== 2 || !MIGRATION_PHASES[state.phase]) {
        return callback(migrationError(
            phase, '<all>', 'system_migrations', 'validate',
            new Error('Invalid ' + MIGRATION_ID + ' migration state')
        ));
    }
    if (state.ownerMapDigest !== ownerMapDigest) {
        return callback(migrationError(
            phase, '<all>', 'system_migrations', 'validate-owner-map',
            new Error('Owner map digest does not match the migration state')
        ));
    }
    if (state.sourceEvidenceDigest !== sourceEvidenceDigest) {
        return callback(migrationError(
            phase, '<all>', 'system_migrations', 'validate-source-evidence',
            new Error('Source evidence digest does not match the migration state')
        ));
    }
    callback(null, state);
}

function getMigrationState(db, ownerMapDigest, sourceEvidenceDigest, phase, callback, createIfMissing) {
    collectionOperation(db, phase, '<all>', 'system_migrations', 'findOne', [
        { _id: MIGRATION_ID }
    ], function (err, state) {
        if (err) return callback(err);
        if (state) return validateMigrationState(
            state, ownerMapDigest, sourceEvidenceDigest, phase, callback
        );
        if (createIfMissing === false) return callback(null, null);

        var initialState = newMigrationState(ownerMapDigest, sourceEvidenceDigest);
        collectionOperation(db, phase, '<all>', 'system_migrations', 'updateOne', [
            { _id: MIGRATION_ID }, { $setOnInsert: initialState }, { upsert: true }
        ], function (err) {
            if (err) return callback(err);

            collectionOperation(db, phase, '<all>', 'system_migrations', 'findOne', [
                { _id: MIGRATION_ID }
            ], function (err, storedState) {
                if (err) return callback(err);
                validateMigrationState(
                    storedState || initialState, ownerMapDigest, sourceEvidenceDigest, phase, callback
                );
            });
        });
    });
}

function setMigrationPhase(db, state, nextPhase, fields, phase, callback) {
    var allowed = {
        pending: { copying: true, failed: true },
        copying: { copying: true, copied: true, failed: true },
        copied: { copying: true, verified: true, failed: true },
        verified: { cutover: true, failed: true },
        cutover: { complete: true, failed: true },
        complete: {},
        failed: { copying: true, failed: true }
    };

    if (!allowed[state.phase] || !allowed[state.phase][nextPhase]) {
        return callback(migrationError(
            phase, '<all>', 'system_migrations', 'transition',
            new Error('Illegal migration transition from ' + state.phase + ' to ' + nextPhase)
        ));
    }

    var values = Object.assign({}, fields || {}, { phase: nextPhase });
    collectionOperation(db, phase, '<all>', 'system_migrations', 'updateOne', [
        { _id: MIGRATION_ID, phase: state.phase }, { $set: values }, {}
    ], function (err, result) {
        if (err) return callback(err);
        if (result && result.matchedCount === 0) {
            return callback(migrationError(
                phase, '<all>', 'system_migrations', 'transition',
                new Error('Migration state changed concurrently')
            ));
        }
        Object.keys(values).forEach(function (key) { state[key] = values[key]; });
        callback(null, state);
    });
}

function markMigrationFailed(db, state, phase, callback) {
    if (!state || state.phase === 'complete') return callback();
    setMigrationPhase(db, state, 'failed', { failedAt: Date.now() }, phase, callback);
}

function isNewerUnifiedDocument(document, startedAt) {
    return document && document.modifiedAt != null && Number(document.modifiedAt) > Number(startedAt);
}

var THING_FIELDS = [
    '_id', 'content', 'createdAt', 'modifiedAt', 'attachments',
    'externalContent', 'public', 'shared', 'archived', 'sticky'
];
var TAG_FIELDS = ['name', 'usage', 'createdAt'];

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

function canonicalField(document, field, expectedValue) {
    if (arguments.length === 3) return { present: true, value: expectedValue };
    if (!Object.prototype.hasOwnProperty.call(document, field)) return { present: false };
    return { present: true, value: document[field] };
}

function canonicalThing(document, source) {
    var record = {};
    THING_FIELDS.forEach(function (field) {
        if (source && (field === 'public' || field === 'shared' ||
                field === 'archived' || field === 'sticky')) {
            record[field] = canonicalField(document, field, !!document[field]);
        } else {
            record[field] = canonicalField(document, field);
        }
    });
    return record;
}

function canonicalTag(document, source, startedAt) {
    return {
        name: canonicalField(document, 'name'),
        usage: source ? canonicalField(document, 'usage', document.usage || 1) :
            canonicalField(document, 'usage'),
        createdAt: source ? canonicalField(document, 'createdAt', document.createdAt || startedAt) :
            canonicalField(document, 'createdAt')
    };
}

function canonicalSettings(document, source) {
    var expectedValue = document && typeof document.value === 'object' ?
        document.value : { title: 'Meemo' };
    return {
        value: source ? canonicalField(document, 'value', expectedValue) :
            canonicalField(document, 'value')
    };
}

function addCanonicalRecord(records, user, id, fields) {
    records.push({ user: user, id: id, fields: fields });
}

function compareCanonicalRecords(user, entity, id, fieldNames, source, target, mismatches) {
    fieldNames.forEach(function (field) {
        if (canonicalJson(source[field]) !== canonicalJson(target[field])) {
            mismatches.push({ user: user, entity: entity, id: String(id), field: field });
        }
    });
}

function sortedRecords(records) {
    return records.slice().sort(function (left, right) {
        var leftRecord = canonicalJson(left);
        var rightRecord = canonicalJson(right);
        if (leftRecord < rightRecord) return -1;
        if (leftRecord > rightRecord) return 1;
        return 0;
    });
}

function recordsHash(records) {
    return crypto.createHash('sha256')
        .update(canonicalJson(sortedRecords(records)))
        .digest('hex');
}

function buildManifest(records) {
    return {
        thingsCount: records.things.length,
        thingsHash: recordsHash(records.things),
        tagsCount: records.tags.length,
        tagsHash: recordsHash(records.tags),
        settingsHash: recordsHash(records.settings)
    };
}

function exactKeys(value, expected) {
    return !!value && typeof value === 'object' && !Array.isArray(value) &&
        canonicalJson(Object.keys(value).sort()) === canonicalJson(expected.slice().sort());
}

function sourceSnapshot(legacy, groups) {
    return ['things', 'tags', 'settings'].reduce(function (facts, type) {
        legacy[type].forEach(function (collection) {
            var documents = groups.reduce(function (all, group) {
                return all.concat((group.inventory[type] || []).filter(function (entry) {
                    return entry.prefix === collection.prefix;
                }).map(function (entry) { return entry.document; }));
            }, []);
            facts.push({
                name: collection.name,
                count: documents.length,
                fingerprint: recordsHash(documents)
            });
        });
        return facts;
    }, []).sort(function (left, right) {
        return left.name < right.name ? -1 : (left.name > right.name ? 1 : 0);
    });
}

function expectedSourceDigest(expectation) {
    return recordsHash([expectation]);
}

function readExpectedSource(options) {
    var expectation;
    requireExpectedDatabase(options);
    if (options.expectedSource) throw new Error('Reviewed expected-source artifact is invalid');
    if (!options.expectedSourceFile) throw new Error('Reviewed expected-source artifact is required');
    var descriptor;
    try {
        var expectationPath = path.resolve(options.expectedSourceFile);
        descriptor = fs.openSync(
            expectationPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW
        );
        var expectationStat = fs.fstatSync(descriptor);
        if (!expectationStat.isFile() || (expectationStat.mode & 0o222) !== 0) {
            throw new Error('not an immutable regular file');
        }
        expectation = JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (ignore) {
        throw new Error('Reviewed expected-source artifact is missing or unreadable');
    } finally {
        if (descriptor !== undefined) fs.closeSync(descriptor);
    }
    if (!exactKeys(expectation, [
        'version', 'migration', 'database', 'ownerMapDigest', 'namespaces'
    ]) || expectation.version !== EXPECTED_SOURCE_VERSION ||
            expectation.migration !== MIGRATION_ID ||
            typeof expectation.database !== 'string' || !expectation.database ||
            typeof expectation.ownerMapDigest !== 'string' ||
            !Array.isArray(expectation.namespaces) || !expectation.namespaces.length) {
        throw new Error('Reviewed expected-source artifact is invalid');
    }
    if (expectation.database !== options.expectedDatabase) {
        throw new Error('Reviewed expected-source database does not match expected database');
    }

    var names = new Set();
    expectation.namespaces.forEach(function (namespace) {
        if (!exactKeys(namespace, ['name', 'count', 'fingerprint']) ||
                typeof namespace.name !== 'string' || !namespace.name ||
                !Number.isSafeInteger(namespace.count) || namespace.count < 0 ||
                !/^[a-f0-9]{64}$/.test(namespace.fingerprint || '') ||
                names.has(namespace.name)) {
            throw new Error('Reviewed expected-source artifact is invalid');
        }
        names.add(namespace.name);
    });
    return expectation;
}

function validateExpectedSource(expectation, snapshot, ownerMapDigest) {
    if (expectation.ownerMapDigest !== ownerMapDigest ||
            canonicalJson(expectation.namespaces) !== canonicalJson(snapshot)) {
        throw new Error('Reviewed expected-source facts do not match the current source');
    }
    return expectation;
}

function hasNonProductionIndicator(value) {
    return value.toLowerCase().split(/[^a-z0-9]+/).some(function (part) {
        return /^(?:test|fixture|sample|demo|rehearsal)\d*$/.test(part);
    });
}

function requireExpectedDatabase(options) {
    if (!options || typeof options.expectedDatabase !== 'string' ||
            !options.expectedDatabase) {
        throw new Error('Explicit expected database is required');
    }
    if (hasNonProductionIndicator(options.expectedDatabase)) {
        throw new Error('Non-production database indicator is forbidden');
    }
}

function validateDatabaseBinding(db, options) {
    requireExpectedDatabase(options);
    if (!db || typeof db.databaseName !== 'string' ||
            db.databaseName !== options.expectedDatabase) {
        throw new Error('Expected database does not match connected database');
    }
    if (hasNonProductionIndicator(db.databaseName)) {
        throw new Error('Non-production database indicator is forbidden');
    }
}

function rejectNonProductionNamespaces(legacy) {
    ['things', 'tags', 'settings'].forEach(function (type) {
        legacy[type].forEach(function (collection) {
            if (hasNonProductionIndicator(collection.prefix)) {
                throw new Error('Non-production namespace indicator is forbidden');
            }
        });
    });
}

function formatMismatch(mismatch) {
    return [
        'Mismatch:',
        'user=' + mismatch.user,
        'entity=' + mismatch.entity,
        'id=' + mismatch.id,
        'field=' + mismatch.field
    ].join('\n');
}

function groupPrefixesByOwner(db, prefixes, ownerMap, phase, plannedOwners, callback) {
    if (typeof plannedOwners === 'function') {
        callback = plannedOwners;
        plannedOwners = null;
    }
    var groupsByOwner = new Map();
    var groups = [];

    async.eachSeries(prefixes, function (prefix, nextPrefix) {
        resolveCanonicalOwner(db, prefix, function (err, canonicalId) {
            if (err) return nextPrefix(err);

            var key = canonicalJson(canonicalId);
            var group = groupsByOwner.get(key);
            if (!group) {
                group = { canonicalId: canonicalId, prefixes: [] };
                groupsByOwner.set(key, group);
                groups.push(group);
            }
            group.prefixes.push(prefix);
            nextPrefix();
        }, phase, ownerMap, plannedOwners);
    }, function (err) {
        callback(err, groups);
    });
}

function legacyPrefixes(legacy) {
    var allPrefixes = Object.create(null);
    legacy.things.forEach(function (c) { allPrefixes[c.prefix] = true; });
    legacy.tags.forEach(function (c) { allPrefixes[c.prefix] = true; });
    legacy.settings.forEach(function (c) { allPrefixes[c.prefix] = true; });
    return Object.keys(allPrefixes);
}

function collapseSettingsEntries(entries) {
    if (!entries.length) return [];
    var expected = canonicalJson(canonicalSettings(entries[0].document, true));
    for (var index = 1; index < entries.length; index++) {
        if (canonicalJson(canonicalSettings(entries[index].document, true)) !== expected) {
            throw new Error('Mapped legacy settings values conflict');
        }
    }
    return [entries[0]];
}

function validateSourceIdentities(entries, identity, entity) {
    var identities = new Map();
    entries.forEach(function (entry) {
        var key = canonicalJson(identity(entry.document));
        if (identities.has(key)) throw new Error('Duplicate mapped legacy ' + entity + ' identity');
        identities.set(key, true);
    });
}

function collapseIdenticalThingEntries(entries) {
    var byIdentity = new Map();
    var collapsed = [];

    entries.forEach(function (entry) {
        var key = canonicalJson(entry.document._id);
        var existing = byIdentity.get(key);
        if (!existing) {
            byIdentity.set(key, entry);
            collapsed.push(entry);
            return;
        }
        if (canonicalJson(canonicalThing(existing.document, true)) !==
                canonicalJson(canonicalThing(entry.document, true))) {
            throw new Error('Conflicting mapped legacy thing identity');
        }
    });

    return collapsed;
}

function findLegacyOwnerDocuments(db, phase, group, suffix, query, callback) {
    async.mapSeries(group.prefixes, function (prefix, nextPrefix) {
        findDocuments(db, phase, prefix, prefix + suffix, query, function (err, documents) {
            if (err) return nextPrefix(err);
            nextPrefix(null, (documents || []).map(function (document) {
                return { document: document, prefix: prefix };
            }));
        });
    }, function (err, documentGroups) {
        if (err) return callback(err);
        callback(null, (documentGroups || []).reduce(function (all, documents) {
            return all.concat(documents);
        }, []));
    });
}

function loadOwnerSources(db, groups, phase, callback) {
    async.eachSeries(groups, function (group, nextGroup) {
        async.parallel({
            things: function (done) {
                findLegacyOwnerDocuments(db, phase + ':things', group, '_things', {}, done);
            },
            tags: function (done) {
                findLegacyOwnerDocuments(db, phase + ':tags', group, '_tags', {}, done);
            },
            settings: function (done) {
                findLegacyOwnerDocuments(
                    db, phase + ':settings', group, '_settings', { type: 'frontend' }, done
                );
            }
        }, function (err, sources) {
            if (err) return nextGroup(err);
            group.inventory = {
                things: sources.things.slice(),
                tags: sources.tags.slice(),
                settings: sources.settings.slice()
            };
            try {
                sources.things = collapseIdenticalThingEntries(sources.things);
                validateSourceIdentities(sources.tags, function (document) {
                    return document.name;
                }, 'tag');
                sources.settings = collapseSettingsEntries(sources.settings);
            } catch (error) {
                return nextGroup(migrationError(
                    phase, '<mapped>', '<legacy>', 'validate-alias-collision', error
                ));
            }
            group.sources = sources;
            nextGroup();
        });
    }, callback);
}

function inspectSource(db, ownerMapInfo, phase, plannedOwners, callback) {
    discoverLegacyCollections(db, function (error, legacy) {
        if (error) return callback(error);
        var prefixes = legacyPrefixes(legacy);
        try {
            rejectNonProductionNamespaces(legacy);
            ownerMaps.validatePrefixes(ownerMapInfo.map, prefixes);
        } catch (validationError) {
            return callback(validationError);
        }
        groupPrefixesByOwner(
            db, prefixes, ownerMapInfo.map, phase + ':resolve-owner', plannedOwners,
            function (groupError, groups) {
                if (groupError) return callback(groupError);
                loadOwnerSources(db, groups, phase, function (sourceError) {
                    if (sourceError) return callback(sourceError);
                    callback(null, {
                        legacy: legacy,
                        prefixes: prefixes,
                        groups: groups,
                        snapshot: sourceSnapshot(legacy, groups)
                    });
                });
            }
        );
    }, phase + ':discovery');
}

function checkSourceAuthority(db, ownerMapInfo, expectation, phase, callback) {
    inspectSource(db, ownerMapInfo, phase, null, function (error, source) {
        if (error) return callback(error);
        try {
            validateExpectedSource(expectation, source.snapshot, ownerMapInfo.digest);
        } catch (validationError) {
            return callback(migrationError(
                phase, '<all>', '<legacy>', 'validate-source-evidence', validationError
            ));
        }
        callback(null, source);
    });
}

function indexCanonicalDocuments(entries, getIdentity, entity, mismatches) {
    var byIdentity = new Map();

    entries.forEach(function (entry) {
        var id = getIdentity(entry.document);
        var key = canonicalJson(id);
        if (byIdentity.has(key)) {
            mismatches.push({
                user: entry.prefix, entity: entity, id: String(id), field: 'identity'
            });
            return;
        }
        byIdentity.set(key, { document: entry.document, prefix: entry.prefix, id: id });
    });
    return byIdentity;
}

function compareOwnerDocuments(options) {
    var sourceMap = indexCanonicalDocuments(
        options.sourceEntries, options.getIdentity, options.entity, options.mismatches
    );
    var targetMap = indexCanonicalDocuments(
        options.targetDocuments.map(function (document) {
            return { document: document, prefix: options.group.canonicalId };
        }), options.getIdentity, options.entity, options.mismatches
    );

    sourceMap.forEach(function (source, key) {
        var target = targetMap.get(key);
        if (!target) {
            addCanonicalRecord(
                options.sourceRecords, options.group.canonicalId, source.id,
                options.canonicalSource(source.document)
            );
            options.mismatches.push({
                user: source.prefix, entity: options.entity,
                id: String(source.id), field: options.identityField
            });
            return;
        }

        targetMap.delete(key);
        if (isNewerUnifiedDocument(target.document, options.startedAt)) return;

        var sourceFields = options.canonicalSource(source.document);
        var targetFields = options.canonicalTarget(target.document);
        addCanonicalRecord(
            options.sourceRecords, options.group.canonicalId, source.id, sourceFields
        );
        addCanonicalRecord(
            options.targetRecords, options.group.canonicalId, target.id, targetFields
        );
        compareCanonicalRecords(
            source.prefix, options.entity, source.id, options.fieldNames,
            sourceFields, targetFields, options.mismatches
        );
    });

    targetMap.forEach(function (target) {
        if (isNewerUnifiedDocument(target.document, options.startedAt)) return;
        addCanonicalRecord(
            options.targetRecords, options.group.canonicalId, target.id,
            options.canonicalTarget(target.document)
        );
        options.mismatches.push({
            user: options.group.canonicalId, entity: options.entity,
            id: String(target.id), field: options.identityField
        });
    });
}

function parseArgs(args) {
    args = args || process.argv.slice(2);
    var options = {
        mode: null,
        mongoUrl: process.env.MONGODB_URL || config.databaseUrl || 'mongodb://127.0.0.1:27017/meemo'
    };

    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--dry-run') options.mode = 'dry-run';
        else if (arg === '--apply') options.mode = 'apply';
        else if (arg === '--verify') options.mode = 'verify';
        else if (arg === '--mongo-url' && args[i + 1]) {
            options.mongoUrl = args[++i];
        } else if (arg === '--owner-map' && args[i + 1]) {
            options.ownerMapPath = args[++i];
        } else if (arg === '--users-file' && args[i + 1]) {
            options.usersFile = args[++i];
        } else if (arg === '--users-manifest' && args[i + 1]) {
            options.usersManifestFile = args[++i];
        } else if (arg === '--expected-source' && args[i + 1]) {
            options.expectedSourceFile = args[++i];
        } else if (arg === '--expect-database' && args[i + 1]) {
            options.expectedDatabase = args[++i];
        } else if (arg === '--help' || arg === '-h') {
            options.mode = 'help';
        } else throw new Error('Unknown or incomplete argument: ' + arg);
    }

    if (!!options.usersFile !== !!options.usersManifestFile) {
        throw new Error('--users-file and --users-manifest are required together');
    }
    if (options.usersFile && options.mode !== 'dry-run') {
        throw new Error('--users-file and --users-manifest are valid only with --dry-run');
    }
    if (options.expectedSourceFile && options.mode !== 'apply' && options.mode !== 'verify') {
        throw new Error('--expected-source is valid only with --apply or --verify');
    }
    if ((options.mode === 'apply' || options.mode === 'verify') && !options.expectedSourceFile) {
        throw new Error('--expected-source is required for apply and verify');
    }
    if (options.mode === 'dry-run' || options.mode === 'apply' || options.mode === 'verify') {
        requireExpectedDatabase(options);
    }

    return options;
}

function getDbConnection(options, phase, callback) {
    try {
        requireExpectedDatabase(options);
    } catch (error) {
        return callback(error);
    }
    if (options && options.db) {
        try {
            validateDatabaseBinding(options.db, options);
        } catch (error) {
            return callback(error);
        }
        config.db = options.db;
        return callback(null, options.db, function close() {
            if (!options.close) return Promise.resolve();
            if (options.close.length === 0) return Promise.resolve().then(options.close);
            return new Promise(function (resolve, reject) {
                options.close(function (error) { if (error) reject(error); else resolve(); });
            });
        });
    }

    var mongoUrl = (options && options.mongoUrl) || process.env.MONGODB_URL || config.databaseUrl || 'mongodb://127.0.0.1:27017/meemo';
    var client;
    var db;
    try {
        client = new MongoClient(mongoUrl);
        db = client.db();
        validateDatabaseBinding(db, options);
    } catch (error) {
        if (!client) return callback(error);
        return closeConnection(function () { return client.close(); }, phase, error, callback);
    }
    mongoOperation(phase, '<all>', '<database>', 'connect', function () {
        return client.connect();
    }, function (err) {
        if (err) {
            return closeConnection(function () { return client.close(); }, phase, err, callback);
        }
        config.db = db;
        callback(null, db, function close() {
            return client.close();
        });
    });
}

function ensureUnifiedIndexes(db, callback) {
    async.series([
        function (next) {
            async.series([
                function (done) {
                    collectionOperation(db, 'apply:indexes', '<all>', 'things', 'createIndex', [
                        { ownerId: 1, modifiedAt: -1 }
                    ], done);
                },
                function (done) {
                    collectionOperation(db, 'apply:indexes', '<all>', 'things', 'createIndex', [
                        { ownerId: 1, sticky: -1, modifiedAt: -1 }
                    ], done);
                },
                function (done) {
                    collectionOperation(db, 'apply:indexes', '<all>', 'things', 'createIndex', [
                        { ownerId: 1, archived: 1, modifiedAt: -1 }
                    ], done);
                },
                function (done) {
                    var collection = db.collection('things');
                    if (typeof collection.indexes !== 'function') {
                        return collectionOperation(db, 'apply:indexes', '<all>', 'things', 'createIndex', [
                            { ownerId: 1, content: 'text', tags: 'text' },
                            { name: 'owner_text_content_tags', weights: { tags: 10, content: 5 } }
                        ], done);
                    }
                    collection.indexes().then(async function (indexes) {
                        var existing = (indexes || []).find(function (idx) {
                            return idx.key && Object.values(idx.key).some(function (v) { return v === 'text'; });
                        });
                        if (existing) {
                            var isTarget = existing.name === 'owner_text_content_tags' &&
                                existing.key &&
                                existing.key.ownerId === 1 &&
                                existing.weights &&
                                existing.weights.tags &&
                                existing.weights.content;
                            if (isTarget) return;
                            if (typeof collection.dropIndex === 'function') {
                                await collection.dropIndex(existing.name);
                            }
                        }
                        await collection.createIndex(
                            { ownerId: 1, content: 'text', tags: 'text' },
                            { name: 'owner_text_content_tags', weights: { tags: 10, content: 5 } }
                        );
                    }).then(function () {
                        done(null);
                    }, function (err) {
                        done(migrationError('apply:indexes', '<all>', 'things', 'createIndex', err));
                    });
                }
            ], next);
        },
        function (next) {
            collectionOperation(db, 'apply:indexes', '<all>', 'tags', 'createIndex', [
                { ownerId: 1, name: 1 }, { unique: true }
            ], next);
        },
        function (next) {
            collectionOperation(db, 'apply:indexes', '<all>', 'settings', 'createIndex', [
                { ownerId: 1 }, { unique: true }
            ], next);
        }
    ], callback);
}

function discoverLegacyCollections(db, callback, phase) {
    var cursor;
    phase = phase || 'discovery';

    try {
        cursor = db.listCollections();
    } catch (error) {
        return callback(migrationError(phase, '<all>', '<database>', 'listCollections', error));
    }

    mongoOperation(phase, '<all>', '<database>', 'toArray', function () {
        return cursor.toArray();
    }, function (err, collList) {
        if (err) return callback(err);

        var thingsColls = [];
        var tagsColls = [];
        var settingsColls = [];

        var standardNames = {
            things: true,
            tags: true,
            settings: true,
            users: true,
            sessions: true
        };

        (collList || []).forEach(function (c) {
            var name = c.name;
            if (name.indexOf('system.') === 0 || standardNames[name]) return;

            var matchThings = name.match(/^(.*)_things$/);
            if (matchThings) {
                thingsColls.push({ name: name, prefix: matchThings[1] });
                return;
            }

            var matchTags = name.match(/^(.*)_tags$/);
            if (matchTags) {
                tagsColls.push({ name: name, prefix: matchTags[1] });
                return;
            }

            var matchSettings = name.match(/^(.*)_settings$/);
            if (matchSettings) {
                settingsColls.push({ name: name, prefix: matchSettings[1] });
            }
        });

        callback(null, {
            things: thingsColls,
            tags: tagsColls,
            settings: settingsColls
        });
    });
}

function resolveCanonicalOwner(db, prefix, callback, phase, ownerMap, plannedOwners) {
    phase = phase || 'resolve-owner';
    if (!config.db && db) config.db = db;
    if (ownerMap && ownerMaps.has(ownerMap, prefix)) {
        return resolveMappedOwner(db, prefix, ownerMap[prefix], callback, phase, plannedOwners);
    }
    if (users && typeof users.resolveUser === 'function') {
        users.resolveUser(prefix, function (err, u) {
            if (!err && u && u.id) {
                return callback(null, u.id, u.username);
            }
            if (err && (!users.UserError || err.code !== users.UserError.NOT_FOUND)) {
                return callback(migrationError(phase, prefix, 'users', 'resolveUser', err));
            }
            lookupInMongoUsers(db, prefix, callback, phase);
        });
    } else {
        lookupInMongoUsers(db, prefix, callback, phase);
    }
}

function resolveMappedOwner(db, prefix, username, callback, phase, plannedOwners) {
    lookupInMongoUsers(db, username, callback, phase, true, prefix, plannedOwners);
}

function lookupInMongoUsers(db, prefix, callback, phase, required, errorOwner, plannedOwners) {
    var query = {
        $or: [
            { usernameNorm: prefix.toLowerCase() },
            { username: prefix }
        ]
    };

    if (ObjectId.isValid(prefix) && String(new ObjectId(prefix)) === prefix) {
        query.$or.unshift({ _id: new ObjectId(prefix) });
    }

    collectionOperation(db, phase, errorOwner || prefix, 'users', 'findOne', [query], function (err, doc) {
        if (err) return callback(err);
        if (doc && plannedOwners && plannedOwners[prefix.toLowerCase()] &&
                String(doc._id) !== plannedOwners[prefix.toLowerCase()]) {
            return callback(migrationError(
                phase, errorOwner || '<mapped>', 'users', 'resolve-mapped-owner',
                new Error('Mapped owner does not match reviewed users manifest')
            ));
        }
        if (!doc && required && plannedOwners && plannedOwners[prefix.toLowerCase()]) {
            return callback(null, plannedOwners[prefix.toLowerCase()], prefix);
        }
        if (!doc && required) {
            return callback(migrationError(
                phase, errorOwner || '<mapped>', 'users', 'resolve-mapped-owner',
                new Error('Mapped owner was not found')
            ));
        }
        if (!doc) return callback(null, prefix, prefix);
        callback(null, String(doc._id), doc.username);
    });
}

function dryRun(options, callback) {
    options = options || {};
    var ownerMapInfo;
    var plannedOwners = null;
    try {
        ownerMapInfo = ownerMaps.load(options.ownerMapPath);
        if (options.usersManifestFile) {
            if (!options.usersFile || !options.mongoUrl) {
                throw new Error('--users-file, --users-manifest, and --mongo-url are required together');
            }
            plannedOwners = {};
            userMigration.loadReviewedRun({
                usersFile: options.usersFile,
                manifestFile: options.usersManifestFile,
                mongoUrl: options.mongoUrl
            }).expectedRecords.forEach(function (record) {
                plannedOwners[record.usernameNorm] = String(record._id);
            });
        }
    } catch (error) {
        return callback(error);
    }
    getDbConnection(options, 'dry-run', function (err, db, close) {
        if (err) return callback(err);

        discoverLegacyCollections(db, function (err, legacy) {
            if (err) {
                return closeConnection(close, 'dry-run', err, callback);
            }

            var userMap = {};
            var prefixes = legacyPrefixes(legacy);
            try {
                rejectNonProductionNamespaces(legacy);
                ownerMaps.validatePrefixes(ownerMapInfo.map, prefixes);
            } catch (error) {
                return closeConnection(close, 'dry-run', error, callback);
            }

            async.eachSeries(prefixes, function (prefix, nextPrefix) {
                resolveCanonicalOwner(db, prefix, function (err, canonicalId, username) {
                    if (err) return nextPrefix(err);

                    var entry = {
                        prefix: prefix,
                        mappedOwner: ownerMaps.has(ownerMapInfo.map, prefix),
                        thingsCount: 0,
                        tagsCount: 0,
                        hasSettings: false
                    };

                    async.series([
                        function (doneThings) {
                            var collName = prefix + '_things';
                            collectionOperation(db, 'dry-run', prefix, collName, 'countDocuments', [], function (e, count) {
                                if (e) return doneThings(e);
                                entry.thingsCount = count || 0;
                                doneThings();
                            });
                        },
                        function (doneTags) {
                            var collName = prefix + '_tags';
                            collectionOperation(db, 'dry-run', prefix, collName, 'countDocuments', [], function (e, count) {
                                if (e) return doneTags(e);
                                entry.tagsCount = count || 0;
                                doneTags();
                            });
                        },
                        function (doneSettings) {
                            var collName = prefix + '_settings';
                            collectionOperation(db, 'dry-run', prefix, collName, 'countDocuments', [], function (e, count) {
                                if (e) return doneSettings(e);
                                entry.hasSettings = Boolean(count && count > 0);
                                doneSettings();
                            });
                        }
                    ], function (err) {
                        if (err) return nextPrefix(err);
                        userMap[prefix] = entry;
                        nextPrefix();
                    });
                }, 'dry-run:resolve-owner', ownerMapInfo.map, plannedOwners);
            }, function (err) {
                if (err) {
                    return closeConnection(close, 'dry-run', err, callback);
                }

                groupPrefixesByOwner(
                    db, prefixes, ownerMapInfo.map, 'dry-run:resolve-owner', plannedOwners,
                    function (groupError, ownerGroups) {
                        if (groupError) {
                            return closeConnection(close, 'dry-run', groupError, callback);
                        }
                        loadOwnerSources(db, ownerGroups, 'dry-run', function (sourceError) {
                            if (sourceError) {
                                return closeConnection(close, 'dry-run', sourceError, callback);
                            }

                            var totalThings = ownerGroups.reduce(function (count, group) {
                                return count + group.sources.things.length;
                            }, 0);
                            var totalTags = ownerGroups.reduce(function (count, group) {
                                return count + group.sources.tags.length;
                            }, 0);
                            var totalSettings = ownerGroups.reduce(function (count, group) {
                                return count + group.sources.settings.length;
                            }, 0);

                            var report = {
                                totalLegacyUsers: prefixes.length,
                                totalThingsToMigrate: totalThings,
                                totalTagsToMigrate: totalTags,
                                totalSettingsToMigrate: totalSettings,
                                ownerMap: {
                                    count: ownerMapInfo.count,
                                    digest: ownerMapInfo.digest
                                },
                                users: userMap
                            };

                            closeConnection(close, 'dry-run', null, function (closeError) {
                                if (closeError) return callback(closeError);
                                callback(null, report);
                            });
                        });
                    }
                );
            });
        }, 'dry-run');
    });
}

function verifySourceAuthority(options, callback) {
    options = options || {};
    var ownerMapInfo;
    var expectation;
    try {
        ownerMapInfo = ownerMaps.load(options.ownerMapPath);
        expectation = readExpectedSource(options);
    } catch (error) {
        return callback(error);
    }
    getDbConnection(options, 'source-authority', function (error, db, close) {
        if (error) return callback(error);
        checkSourceAuthority(db, ownerMapInfo, expectation, 'source-authority', function (error) {
            if (error) return closeConnection(close, 'source-authority', error, callback);
            getMigrationState(
                db, ownerMapInfo.digest, expectedSourceDigest(expectation),
                'source-authority:state', function (stateError, state) {
                    if (!stateError && (!state || state.phase !== 'complete')) {
                        stateError = migrationError(
                            'source-authority:state', '<all>', 'system_migrations', 'validate',
                            new Error('Completed source-bound migration evidence is required')
                        );
                    }
                    closeConnection(close, 'source-authority', stateError, function (closeError) {
                        if (closeError) return callback(closeError);
                        callback(null);
                    });
                }, false
            );
        });
    });
}

function apply(options, callback) {
    options = options || {};
    var ownerMapInfo;
    var expectedSource;
    try {
        ownerMapInfo = ownerMaps.load(options.ownerMapPath);
        expectedSource = readExpectedSource(options);
    } catch (error) {
        return callback(error);
    }
    getDbConnection(options, 'apply', function (err, db, close) {
        if (err) return callback(err);

        var state;
        function finishApply(error, stats) {
            if (error) {
                return markMigrationFailed(db, state, 'apply:state', function () {
                    closeConnection(close, 'apply', error, callback);
                });
            }

            setMigrationPhase(db, state, 'copied', {
                copiedAt: Date.now(),
                failedAt: null
            }, 'apply:state', function (stateError) {
                closeConnection(close, 'apply', stateError, function (finishError) {
                    if (finishError) return callback(finishError);
                    callback(null, stats);
                });
            });
        }

        function startApply() {
        getMigrationState(
            db, ownerMapInfo.digest, expectedSourceDigest(expectedSource),
            'apply:state', function (err, currentState) {
            if (err) return closeConnection(close, 'apply', err, callback);
            state = currentState;

            if (state.phase === 'complete') {
                return closeConnection(close, 'apply', migrationError(
                    'apply:state', '<all>', 'system_migrations', 'transition',
                    new Error('Migration ' + MIGRATION_ID + ' is already complete')
                ), callback);
            }
            if (!APPLY_PHASES[state.phase]) {
                return closeConnection(close, 'apply', migrationError(
                    'apply:state', '<all>', 'system_migrations', 'transition',
                    new Error('Cannot apply migration from phase ' + state.phase)
                ), callback);
            }

            var startedAt = state.startedAt == null ? Date.now() : state.startedAt;
            setMigrationPhase(db, state, 'copying', {
                startedAt: startedAt,
                copiedAt: null,
                verifiedAt: null,
                failedAt: null
            }, 'apply:state', function (err) {
                if (err) return closeConnection(close, 'apply', err, callback);

                ensureUnifiedIndexes(db, function (err) {
                    if (err) return finishApply(err);

                    discoverLegacyCollections(db, function (err, legacy) {
                        if (err) return finishApply(err);

                        var stats = {
                            migratedThings: 0,
                            migratedTags: 0,
                            migratedSettings: 0,
                            usersProcessed: 0
                        };
                        var prefixes = legacyPrefixes(legacy);
                        try {
                            ownerMaps.validatePrefixes(ownerMapInfo.map, prefixes);
                        } catch (error) {
                            return finishApply(error);
                        }

                        groupPrefixesByOwner(
                            db, prefixes, ownerMapInfo.map, 'apply:resolve-owner',
                            function (err, ownerGroups) {
                                if (err) return finishApply(err);
                                loadOwnerSources(db, ownerGroups, 'apply', function (err) {
                                    if (err) return finishApply(err);
                                    try {
                                        validateExpectedSource(
                                            expectedSource, sourceSnapshot(legacy, ownerGroups),
                                            ownerMapInfo.digest
                                        );
                                    } catch (validationError) {
                                        return finishApply(migrationError(
                                            'apply', '<all>', '<legacy>',
                                            'validate-source-evidence', validationError
                                        ));
                                    }

                                    async.eachSeries(ownerGroups, function (group, nextUser) {
                                        var canonicalId = group.canonicalId;
                                        async.series([
                            // Migrate Things
                            function (doneThings) {
                                var docs = group.sources.things;
                                    if (!docs || docs.length === 0) return doneThings();

                                    async.eachSeries(docs, function (entry, nextDoc) {
                                        var doc = entry.document;
                                        var prefix = entry.prefix;
                                        doc.ownerId = canonicalId;
                                        doc.public = !!doc.public;
                                        doc.shared = !!doc.shared;
                                        doc.archived = !!doc.archived;
                                        doc.sticky = !!doc.sticky;

                                        collectionOperation(db, 'apply:things', prefix, 'things', 'findOne', [
                                            { _id: doc._id }
                                        ], function (e, unifiedDoc) {
                                            if (e) return nextDoc(e);
                                            if (isNewerUnifiedDocument(unifiedDoc, startedAt)) return nextDoc();

                                            collectionOperation(db, 'apply:things', prefix, 'things', 'replaceOne', [
                                                {
                                                    _id: doc._id,
                                                    $or: [
                                                        { modifiedAt: { $lte: startedAt } },
                                                        { modifiedAt: { $exists: false } },
                                                        { modifiedAt: null }
                                                    ]
                                                }, doc, { upsert: true }
                                            ], function (e) {
                                                if (e) return nextDoc(e);
                                                stats.migratedThings++;
                                                nextDoc();
                                            });
                                        });
                                    }, doneThings);
                            },

                            // Migrate Tags
                            function (doneTags) {
                                var docs = group.sources.tags;
                                    if (!docs || docs.length === 0) return doneTags();

                                    async.eachSeries(docs, function (entry, nextTag) {
                                        var tagDoc = entry.document;
                                        var prefix = entry.prefix;
                                        var filter = { ownerId: canonicalId, name: tagDoc.name };
                                        var updateDoc = {
                                            $set: {
                                                ownerId: canonicalId,
                                                name: tagDoc.name,
                                                usage: tagDoc.usage || 1,
                                                modifiedAt: tagDoc.modifiedAt || tagDoc.createdAt || startedAt
                                            },
                                            $setOnInsert: {
                                                createdAt: tagDoc.createdAt || startedAt
                                            }
                                        };

                                        collectionOperation(db, 'apply:tags', prefix, 'tags', 'findOne', [
                                            filter
                                        ], function (e, unifiedTag) {
                                            if (e) return nextTag(e);
                                            if (isNewerUnifiedDocument(unifiedTag, startedAt)) return nextTag();

                                            filter.$or = [
                                                { modifiedAt: { $lte: startedAt } },
                                                { modifiedAt: { $exists: false } },
                                                { modifiedAt: null }
                                            ];
                                            collectionOperation(db, 'apply:tags', prefix, 'tags', 'updateOne', [
                                                filter, updateDoc, { upsert: true }
                                            ], function (e) {
                                                if (e) return nextTag(e);
                                                stats.migratedTags++;
                                                nextTag();
                                            });
                                        });
                                    }, doneTags);
                            },

                            // Migrate Settings
                            function (doneSettings) {
                                var entry = group.sources.settings[0];
                                var setDoc = entry && entry.document;
                                var prefix = entry && entry.prefix || group.prefixes[0];
                                    if (!setDoc) return doneSettings();

                                    var docToSave = {
                                        ownerId: canonicalId,
                                        type: 'frontend',
                                        value: (setDoc && typeof setDoc.value === 'object') ? setDoc.value : { title: 'Meemo' },
                                        modifiedAt: setDoc.modifiedAt || startedAt
                                    };

                                    collectionOperation(db, 'apply:settings', prefix, 'settings', 'findOne', [
                                        { ownerId: canonicalId }
                                    ], function (e, unifiedSettings) {
                                        if (e) return doneSettings(e);
                                        if (isNewerUnifiedDocument(unifiedSettings, startedAt)) return doneSettings();

                                        collectionOperation(db, 'apply:settings', prefix, 'settings', 'replaceOne', [
                                            {
                                                ownerId: canonicalId,
                                                $or: [
                                                    { modifiedAt: { $lte: startedAt } },
                                                    { modifiedAt: { $exists: false } },
                                                    { modifiedAt: null }
                                                ]
                                            }, docToSave, { upsert: true }
                                        ], function (e) {
                                            if (e) return doneSettings(e);
                                            stats.migratedSettings++;
                                            doneSettings();
                                        });
                                    });
                            }
                        ], function (err) {
                            if (err) return nextUser(err);
                            stats.usersProcessed++;
                            nextUser();
                        });
                                    }, function (err) {
                                        finishApply(err, stats);
                                    });
                                });
                            }
                        );
                    }, 'apply:discovery');
                });
            });
        });
        }

        checkSourceAuthority(db, ownerMapInfo, expectedSource, 'apply:authority', function (error) {
            if (error) return closeConnection(close, 'apply', error, callback);
            startApply();
        });
    });
}

function verify(options, callback) {
    options = options || {};
    var ownerMapInfo;
    var expectedSource;
    try {
        ownerMapInfo = ownerMaps.load(options.ownerMapPath);
        expectedSource = readExpectedSource(options);
    } catch (error) {
        return callback(error);
    }
    getDbConnection(options, 'verify', function (err, db, close) {
        if (err) return callback(err);

        var state;
        function finishVerify(error, result) {
            if (state.phase !== 'copied') {
                return closeConnection(close, 'verify', error, function (finishError) {
                    if (finishError) return callback(finishError);
                    callback(null, result);
                });
            }

            if (error) {
                return markMigrationFailed(db, state, 'verify:state', function () {
                    closeConnection(close, 'verify', error, callback);
                });
            }

            setMigrationPhase(db, state, 'verified', {
                verifiedAt: Date.now(),
                failedAt: null
            }, 'verify:state', function (stateError) {
                closeConnection(close, 'verify', stateError, function (finishError) {
                    if (finishError) return callback(finishError);
                    callback(null, result);
                });
            });
        }

        function startVerify() {
        getMigrationState(
            db, ownerMapInfo.digest, expectedSourceDigest(expectedSource),
            'verify:state', function (err, currentState) {
            if (err) return closeConnection(close, 'verify', err, callback);
            if (!currentState) {
                return closeConnection(close, 'verify', migrationError(
                    'verify:state', '<all>', 'system_migrations', 'validate',
                    new Error('Verification requires durable source-bound migration state')
                ), callback);
            }
            state = currentState;

            if (state.phase !== 'copied' && state.phase !== 'verified' &&
                    state.phase !== 'cutover' && state.phase !== 'complete') {
                return closeConnection(close, 'verify', migrationError(
                    'verify:state', '<all>', 'system_migrations', 'transition',
                    new Error('Cannot verify migration from phase ' + state.phase)
                ), callback);
            }

            discoverLegacyCollections(db, function (err, legacy) {
                if (err) return finishVerify(err);

            var prefixes = legacyPrefixes(legacy);
            try {
                ownerMaps.validatePrefixes(ownerMapInfo.map, prefixes);
            } catch (error) {
                return finishVerify(error);
            }
            var mismatches = [];
            var verifiedCount = 0;
            var sourceRecords = { things: [], tags: [], settings: [] };
            var targetRecords = { things: [], tags: [], settings: [] };

            groupPrefixesByOwner(
                db, prefixes, ownerMapInfo.map, 'verify:resolve-owner', function (err, ownerGroups) {
                if (err) return finishVerify(err);

                async.eachSeries(ownerGroups, function (group, nextOwner) {
                    async.series([
                        function (doneCheckThings) {
                            findLegacyOwnerDocuments(
                                db, 'verify:things', group, '_things', {}, function (err, sourceEntries) {
                                    if (err) return doneCheckThings(err);
                                    try {
                                        sourceEntries = collapseIdenticalThingEntries(sourceEntries);
                                    } catch (error) {
                                        return doneCheckThings(error);
                                    }
                                    findDocuments(
                                        db, 'verify:things', group.canonicalId, 'things',
                                        { ownerId: group.canonicalId }, function (err, targetDocuments) {
                                            if (err) return doneCheckThings(err);
                                            compareOwnerDocuments({
                                                group: group,
                                                sourceEntries: sourceEntries,
                                                targetDocuments: targetDocuments || [],
                                                getIdentity: function (document) { return document._id; },
                                                entity: 'thing',
                                                identityField: '_id',
                                                fieldNames: THING_FIELDS,
                                                canonicalSource: function (document) {
                                                    return canonicalThing(document, true);
                                                },
                                                canonicalTarget: function (document) {
                                                    return canonicalThing(document, false);
                                                },
                                                sourceRecords: sourceRecords.things,
                                                targetRecords: targetRecords.things,
                                                mismatches: mismatches,
                                                startedAt: state.startedAt
                                            });
                                            doneCheckThings();
                                        }
                                    );
                                }
                            );
                        },
                        function (doneCheckTags) {
                            findLegacyOwnerDocuments(
                                db, 'verify:tags', group, '_tags', {}, function (err, sourceEntries) {
                                    if (err) return doneCheckTags(err);
                                    findDocuments(
                                        db, 'verify:tags', group.canonicalId, 'tags',
                                        { ownerId: group.canonicalId }, function (err, targetDocuments) {
                                            if (err) return doneCheckTags(err);
                                            compareOwnerDocuments({
                                                group: group,
                                                sourceEntries: sourceEntries,
                                                targetDocuments: targetDocuments || [],
                                                getIdentity: function (document) { return document.name; },
                                                entity: 'tag',
                                                identityField: 'name',
                                                fieldNames: TAG_FIELDS,
                                                canonicalSource: function (document) {
                                                    return canonicalTag(document, true, state.startedAt);
                                                },
                                                canonicalTarget: function (document) {
                                                    return canonicalTag(document, false, state.startedAt);
                                                },
                                                sourceRecords: sourceRecords.tags,
                                                targetRecords: targetRecords.tags,
                                                mismatches: mismatches,
                                                startedAt: state.startedAt
                                            });
                                            doneCheckTags();
                                        }
                                    );
                                }
                            );
                        },
                        function (doneCheckSettings) {
                            findLegacyOwnerDocuments(
                                db, 'verify:settings', group, '_settings',
                                { type: 'frontend' }, function (err, sourceEntries) {
                                    if (err) return doneCheckSettings(err);
                                    try {
                                        sourceEntries = collapseSettingsEntries(sourceEntries);
                                    } catch (error) {
                                        return doneCheckSettings(migrationError(
                                            'verify:settings', '<mapped>', '<legacy>',
                                            'validate-alias-collision', error
                                        ));
                                    }
                                    findDocuments(
                                        db, 'verify:settings', group.canonicalId, 'settings',
                                        { ownerId: group.canonicalId }, function (err, targetDocuments) {
                                            if (err) return doneCheckSettings(err);
                                            compareOwnerDocuments({
                                                group: group,
                                                sourceEntries: sourceEntries,
                                                targetDocuments: targetDocuments || [],
                                                getIdentity: function () { return 'frontend'; },
                                                entity: 'settings',
                                                identityField: 'value',
                                                fieldNames: ['value'],
                                                canonicalSource: function (document) {
                                                    return canonicalSettings(document, true);
                                                },
                                                canonicalTarget: function (document) {
                                                    return canonicalSettings(document, false);
                                                },
                                                sourceRecords: sourceRecords.settings,
                                                targetRecords: targetRecords.settings,
                                                mismatches: mismatches,
                                                startedAt: state.startedAt
                                            });
                                            doneCheckSettings();
                                        }
                                    );
                                }
                            );
                        }
                    ], function (err) {
                        if (err) return nextOwner(err);
                        verifiedCount++;
                        nextOwner();
                    });
                }, function (err) {
                    if (err) return finishVerify(err);

                    var sourceManifest = buildManifest(sourceRecords);
                    var targetManifest = buildManifest(targetRecords);
                    var manifestFields = [
                        'thingsCount', 'thingsHash', 'tagsCount', 'tagsHash', 'settingsHash'
                    ];

                    if (mismatches.length === 0) {
                        manifestFields.some(function (field) {
                            if (sourceManifest[field] === targetManifest[field]) return false;
                            mismatches.push({
                                user: '<all>', entity: 'manifest', id: '<all>', field: field
                            });
                            return true;
                        });
                    }

                    var result = {
                        verifiedUsers: verifiedCount,
                        mismatches: mismatches,
                        success: mismatches.length === 0,
                        manifest: sourceManifest
                    };

                    if (!result.success) {
                        return finishVerify(migrationError(
                            'verify', '<all>', '<unified>', 'fidelity-check',
                            new Error(
                                'Verification failed with ' + mismatches.length + ' mismatches:\n' +
                                mismatches.map(formatMismatch).join('\n')
                            )
                        ));
                    }

                    finishVerify(null, result);
                });
            });
            }, 'verify:discovery');
        }, false);
        }

        checkSourceAuthority(db, ownerMapInfo, expectedSource, 'verify:authority', function (error) {
            if (error) return closeConnection(close, 'verify', error, callback);
            startVerify();
        });
    });
}

function main() {
    var options;
    try {
        options = parseArgs();
    } catch (error) {
        console.error('MIGRATION_ARGUMENT_ERROR');
        process.exit(1);
    }

    if (!options.mode || options.mode === 'help') {
        console.log('Usage: node scripts/migrate-data-to-v2.js [--dry-run | --apply --expected-source <file> | --verify --expected-source <file>] --expect-database <name> [--mongo-url <url>] [--owner-map <file>] [--users-file <file> --users-manifest <file>]');
        process.exit(options.mode === 'help' ? 0 : 1);
    }

    if (options.mode === 'dry-run') {
        console.log('Running dry-run data migration plan...');
        dryRun(options, function (err, report) {
            if (err) {
                console.error('DATA_MIGRATION_DRY_RUN_FAILED');
                process.exit(1);
            }
            console.log('Dry-run plan summary:');
            console.log('  Legacy users found:', report.totalLegacyUsers);
            console.log('  Things to migrate: ', report.totalThingsToMigrate);
            console.log('  Tags to migrate:   ', report.totalTagsToMigrate);
            console.log('  Settings to migrate:', report.totalSettingsToMigrate);
            process.exit(0);
        });
    } else if (options.mode === 'apply') {
        console.log('Applying data migration to unified collections...');
        apply(options, function (err, stats) {
            if (err) {
                console.error('DATA_MIGRATION_APPLY_FAILED');
                process.exit(1);
            }
            console.log('Migration completed successfully:');
            console.log('  Users processed:   ', stats.usersProcessed);
            console.log('  Things migrated:   ', stats.migratedThings);
            console.log('  Tags migrated:     ', stats.migratedTags);
            console.log('  Settings migrated: ', stats.migratedSettings);
            process.exit(0);
        });
    } else if (options.mode === 'verify') {
        console.log('Verifying data migration fidelity between legacy and unified collections...');
        verify(options, function (err, result) {
            if (err) {
                console.error('DATA_MIGRATION_VERIFICATION_FAILED');
                process.exit(1);
            }
            console.log(JSON.stringify(result.manifest, null, 2));
            console.log('Migration verification succeeded.');
            console.log('Canonical source and target manifests match.');
            process.exit(0);
        });
    }
}

module.exports = {
    parseArgs: parseArgs,
    dryRun: dryRun,
    apply: apply,
    verify: verify,
    verifySourceAuthority: verifySourceAuthority,
    readExpectedSource: readExpectedSource,
    discoverLegacyCollections: discoverLegacyCollections,
    resolveCanonicalOwner: resolveCanonicalOwner
};

if (require.main === module) {
    main();
}
