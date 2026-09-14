#!/usr/bin/env node

/* jslint node:true */

'use strict';

var crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    mongodb = require('mongodb'),
    MongoClient = mongodb.MongoClient,
    ObjectId = mongodb.ObjectId;

var EVIDENCE_ID = 'users-file-to-mongo';
var MANIFEST_VERSION = 1;
var DURABLE_WRITE = { writeConcern: { w: 'majority', j: true } };
var USER_FIELDS = [
    'username', 'usernameNorm', 'displayName', 'email',
    'passwordHash', 'status', 'createdAt'
];
var USAGE = [
    'Usage: node scripts/migrate-users-to-mongo.js [--dry-run | --apply | --verify]',
    '  --users-file <path> --mongo-url <url> --manifest <path>',
    '',
    '--dry-run creates the reviewed manifest with exclusive file creation.',
    '--apply and --verify consume that exact manifest and reject changed source or target identities.'
].join('\n');

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

function digest(value) {
    return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function digestBytes(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function nextArgument(args, index, name) {
    var value = args[index + 1];
    if (!value || value.indexOf('--') === 0) throw new Error(name + ' requires a value');
    return value;
}

function parseArgs(argv) {
    var args = argv || process.argv.slice(2);
    var options = { mode: null };
    var seen = {};

    function setOnce(name, key, value) {
        if (seen[name]) throw new Error('Duplicate argument: ' + name);
        seen[name] = true;
        options[key] = value;
    }

    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--dry-run' || arg === '--apply' || arg === '--verify') {
            if (options.mode) throw new Error('Exactly one migration mode is required');
            options.mode = arg.slice(2);
        } else if (arg === '--users-file') {
            setOnce(arg, 'usersFile', path.resolve(nextArgument(args, i, arg)));
            i++;
        } else if (arg === '--mongo-url') {
            setOnce(arg, 'mongoUrl', nextArgument(args, i, arg));
            i++;
        } else if (arg === '--manifest') {
            setOnce(arg, 'manifestFile', path.resolve(nextArgument(args, i, arg)));
            i++;
        } else if (arg === '--help' || arg === '-h') {
            if (args.length !== 1) throw new Error('--help cannot be combined with other arguments');
            return { mode: 'help' };
        } else {
            throw new Error('Unknown argument: ' + arg);
        }
    }

    if (!options.mode) throw new Error('Exactly one migration mode is required');
    validateOptions(options);
    return options;
}

function validateOptions(options) {
    if (!options || typeof options !== 'object') throw new Error('Migration options are required');
    if (typeof options.usersFile !== 'string' || !options.usersFile.trim()) {
        throw new Error('--users-file must explicitly identify the source');
    }
    if (typeof options.mongoUrl !== 'string' || !options.mongoUrl.trim()) {
        throw new Error('--mongo-url must explicitly identify the target');
    }
    if (typeof options.manifestFile !== 'string' || !options.manifestFile.trim()) {
        throw new Error('--manifest must explicitly identify the reviewed manifest');
    }
}

function readSourceUsers(usersFilePath) {
    var resolved = path.resolve(usersFilePath);
    var realPath;
    var raw;
    var parsed;

    try {
        realPath = fs.realpathSync(resolved);
        if (!fs.statSync(realPath).isFile()) throw new Error('not a regular file');
        raw = fs.readFileSync(realPath);
    } catch (error) {
        throw new Error('Failed to read users file ' + resolved + ': ' + error.message);
    }

    try {
        parsed = JSON.parse(raw.toString('utf8'));
    } catch (error) {
        throw new Error('Failed to parse users file: ' + error.message);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Source file does not contain a JSON user map');
    }
    if (Object.keys(parsed).length === 0) {
        throw new Error('Source file contains an unexpected zero users');
    }
    return { users: parsed, path: realPath, raw: raw };
}

function inspectSource(options) {
    var source = readSourceUsers(options.usersFile);
    var keys = Object.keys(source.users);
    var normalized = Object.create(null);
    var collisions = [];
    var invalidUsers = [];

    keys.forEach(function (key) {
        var user = source.users[key];
        if (!user || typeof user !== 'object' || Array.isArray(user)) {
            invalidUsers.push(key);
            return;
        }
        var username = user.username === undefined ? key : user.username;
        if (typeof username !== 'string' || !username) {
            invalidUsers.push(key + ' (invalid username)');
            return;
        }
        if (typeof user.passwordHash !== 'string' || !user.passwordHash) {
            invalidUsers.push(username + ' (missing passwordHash)');
        }
        var usernameNorm = username.toLowerCase();
        if (normalized[usernameNorm]) {
            collisions.push({ norm: usernameNorm, first: normalized[usernameNorm], second: username });
        } else {
            normalized[usernameNorm] = username;
        }
    });

    if (collisions.length || invalidUsers.length) {
        var details = [];
        if (collisions.length) details.push('Normalization collisions detected: ' + JSON.stringify(collisions));
        if (invalidUsers.length) details.push('Invalid user records detected: ' + invalidUsers.join(', '));
        throw new Error(details.join('; '));
    }

    return {
        users: source.users,
        usersFile: source.path,
        raw: source.raw,
        keys: keys,
        collisions: collisions,
        invalidUsers: invalidUsers,
        sourceManifest: {
            identity: source.path,
            byteCount: source.raw.length,
            byteDigest: digestBytes(source.raw),
            canonicalDigest: digest(source.users),
            count: keys.length
        }
    };
}

function sanitizedTargetIdentity(mongoUrl) {
    var client;
    try {
        client = new MongoClient(mongoUrl);
    } catch (error) {
        throw new Error('Invalid target database URL');
    }
    var hosts = (client.options.hosts || []).map(function (host) { return String(host); });
    if (client.options.srvHost) hosts.push(client.options.srvHost);
    hosts.sort();
    return { database: client.options.dbName, hosts: hosts };
}

function generatedUsernameToId(source) {
    var mapping = {};
    source.keys.map(function (key) {
        var user = source.users[key];
        return (user.username === undefined ? key : user.username).toLowerCase();
    }).sort().forEach(function (usernameNorm) {
        mapping[usernameNorm] = String(new ObjectId());
    });
    return mapping;
}

function transformedUsers(source, transformationTimestamp, usernameToId) {
    return source.keys.map(function (key) {
        var user = source.users[key];
        var username = user.username === undefined ? key : user.username;
        var usernameNorm = username.toLowerCase();
        return {
            _id: new ObjectId(usernameToId[usernameNorm]),
            username: username,
            usernameNorm: usernameNorm,
            displayName: user.displayName || username,
            email: user.email || '',
            passwordHash: user.passwordHash,
            status: 'active',
            createdAt: typeof user.createdAt === 'number' ? user.createdAt : transformationTimestamp
        };
    }).sort(function (left, right) {
        return left.usernameNorm < right.usernameNorm ? -1 :
            (left.usernameNorm > right.usernameNorm ? 1 : 0);
    });
}

function canonicalRecord(record) {
    var canonical = { _id: String(record._id) };
    USER_FIELDS.forEach(function (field) { canonical[field] = record[field]; });
    return canonical;
}

function transformedManifest(records) {
    return { count: records.length, digest: digest(records.map(canonicalRecord)) };
}

function manifestWithoutDigest(manifest) {
    var copy = {};
    Object.keys(manifest).forEach(function (key) {
        if (key !== 'manifestDigest') copy[key] = manifest[key];
    });
    return copy;
}

function buildManifest(source, options) {
    var transformationTimestamp = Date.now();
    var usernameToId = generatedUsernameToId(source);
    var records = transformedUsers(source, transformationTimestamp, usernameToId);
    var manifest = {
        version: MANIFEST_VERSION,
        migration: EVIDENCE_ID,
        runId: crypto.randomUUID(),
        source: source.sourceManifest,
        transformationTimestamp: transformationTimestamp,
        target: sanitizedTargetIdentity(options.mongoUrl),
        transformed: transformedManifest(records),
        usernameToId: usernameToId
    };
    manifest.manifestDigest = digest(manifest);
    return manifest;
}

function exactKeys(value, expected, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
            stableJson(Object.keys(value).sort()) !== stableJson(expected.slice().sort())) {
        throw new Error('Reviewed manifest has invalid ' + label + ' fields');
    }
}

function readManifest(manifestFile) {
    var resolved = path.resolve(manifestFile);
    var parsed;
    try {
        if (!fs.statSync(resolved).isFile()) throw new Error('not a regular file');
        parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
    } catch (error) {
        throw new Error('Failed to read reviewed manifest ' + resolved + ': ' + error.message);
    }
    return parsed;
}

function validateManifest(manifest, source, options) {
    exactKeys(manifest, [
        'version', 'migration', 'runId', 'source', 'transformationTimestamp',
        'target', 'transformed', 'usernameToId', 'manifestDigest'
    ], 'top-level');
    exactKeys(manifest.source, [
        'identity', 'byteCount', 'byteDigest', 'canonicalDigest', 'count'
    ], 'source');
    exactKeys(manifest.target, ['database', 'hosts'], 'target');
    exactKeys(manifest.transformed, ['count', 'digest'], 'transformed');

    if (manifest.version !== MANIFEST_VERSION || manifest.migration !== EVIDENCE_ID ||
            typeof manifest.runId !== 'string' ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(manifest.runId)) {
        throw new Error('Reviewed manifest has an unsupported version or run identity');
    }
    if (typeof manifest.manifestDigest !== 'string' ||
            !/^[a-f0-9]{64}$/.test(manifest.manifestDigest) ||
            digest(manifestWithoutDigest(manifest)) !== manifest.manifestDigest) {
        throw new Error('Reviewed manifest digest is invalid; the artifact may have been tampered with');
    }
    if (stableJson(manifest.source) !== stableJson(source.sourceManifest)) {
        if (manifest.source.identity !== source.sourceManifest.identity) {
            throw new Error('Reviewed manifest source identity does not match the resolved source');
        }
        throw new Error('Reviewed manifest source bytes or canonical content do not match the source');
    }
    if (stableJson(manifest.target) !== stableJson(sanitizedTargetIdentity(options.mongoUrl))) {
        throw new Error('Reviewed manifest target database identity does not match the explicit target');
    }
    if (!Number.isSafeInteger(manifest.transformationTimestamp) || manifest.transformationTimestamp <= 0) {
        throw new Error('Reviewed manifest transformation timestamp is invalid');
    }

    var expectedNorms = source.keys.map(function (key) {
        var user = source.users[key];
        return (user.username === undefined ? key : user.username).toLowerCase();
    }).sort();
    exactKeys(manifest.usernameToId, expectedNorms, 'username-to-id mapping');
    var ids = Object.keys(manifest.usernameToId).map(function (usernameNorm) {
        var id = manifest.usernameToId[usernameNorm];
        if (typeof id !== 'string' || !/^[a-f0-9]{24}$/.test(id) || !ObjectId.isValid(id)) {
            throw new Error('Reviewed manifest contains an invalid generated user id');
        }
        return id;
    });
    if (new Set(ids).size !== ids.length) throw new Error('Reviewed manifest contains duplicate generated user ids');

    var records = transformedUsers(source, manifest.transformationTimestamp, manifest.usernameToId);
    if (stableJson(manifest.transformed) !== stableJson(transformedManifest(records))) {
        throw new Error('Reviewed manifest transformed digest does not match the canonical transformation');
    }
    return records;
}

function evidenceMatches(evidence, manifest) {
    return evidence && evidence.manifestDigest === manifest.manifestDigest &&
        evidence.runId === manifest.runId && stableJson(evidence.manifest) === stableJson(manifest);
}

function recordMismatches(expected, actual) {
    var mismatches = [];
    if (String(actual._id) !== String(expected._id)) mismatches.push('_id');
    USER_FIELDS.forEach(function (field) {
        if (!Object.prototype.hasOwnProperty.call(actual, field) ||
                stableJson(actual[field]) !== stableJson(expected[field])) {
            mismatches.push(field);
        }
    });
    var allowed = ['_id'].concat(USER_FIELDS);
    Object.keys(actual).forEach(function (field) {
        if (allowed.indexOf(field) === -1) mismatches.push('unexpected field ' + field);
    });
    return mismatches;
}

function compareTarget(expectedRecords, targetRecords, allowMissing) {
    var expected = Object.create(null);
    var actual = Object.create(null);
    var mismatches = [];

    expectedRecords.forEach(function (record) { expected[record.usernameNorm] = record; });
    targetRecords.forEach(function (record) {
        var identity = typeof record.usernameNorm === 'string' ?
            record.usernameNorm : String(record._id || '<unknown>');
        if (!expected[record.usernameNorm]) {
            mismatches.push('Unexpected target user ' + identity);
        } else if (actual[record.usernameNorm]) {
            mismatches.push('Duplicate target user ' + identity);
        } else {
            actual[record.usernameNorm] = record;
            var fields = recordMismatches(expected[record.usernameNorm], record);
            if (fields.length) mismatches.push('Target divergence for ' + identity + ': ' + fields.join(', '));
        }
    });

    if (!allowMissing) {
        expectedRecords.forEach(function (record) {
            if (!actual[record.usernameNorm]) mismatches.push('Target user missing: ' + record.username);
        });
        if (targetRecords.length !== expectedRecords.length) {
            mismatches.push('Target count mismatch: expected ' + expectedRecords.length + ', got ' + targetRecords.length);
        }
    }
    return { mismatches: mismatches, actual: actual };
}

function exactUsernameNormIndex(index) {
    return index && index.key && Object.keys(index.key).length === 1 && index.key.usernameNorm === 1;
}

function compatibleUsernameNormIndex(index) {
    return exactUsernameNormIndex(index) && index.unique === true && index.sparse !== true &&
        !index.partialFilterExpression && !index.collation;
}

async function listIndexes(collection) {
    try {
        return await collection.listIndexes().toArray();
    } catch (error) {
        if (error.code === 26 || error.codeName === 'NamespaceNotFound') return [];
        throw error;
    }
}

async function requireExactUsernameNormIndex(collection, createIfMissing) {
    var indexes = await listIndexes(collection);
    var exact = indexes.filter(exactUsernameNormIndex);
    var namedConflict = indexes.some(function (index) {
        return index.name === 'usernameNorm_1' && !exactUsernameNormIndex(index);
    });
    if (namedConflict || exact.some(function (index) { return !compatibleUsernameNormIndex(index); })) {
        throw new Error('Target users collection does not have the exact unique usernameNorm index');
    }
    if (exact.some(compatibleUsernameNormIndex)) return;
    if (!createIfMissing) throw new Error('Target users collection does not have the exact unique usernameNorm index');

    try {
        await collection.createIndex(
            { usernameNorm: 1 },
            { name: 'usernameNorm_1', unique: true, writeConcern: DURABLE_WRITE.writeConcern }
        );
    } catch (error) {
        throw new Error('Failed to create the exact unique usernameNorm index');
    }
    indexes = await listIndexes(collection);
    exact = indexes.filter(exactUsernameNormIndex);
    if (exact.length !== 1 || !compatibleUsernameNormIndex(exact[0])) {
        throw new Error('Target users collection does not have the exact unique usernameNorm index');
    }
}

function isDuplicateKey(error) {
    return error && (error.code === 11000 || (error.message && error.message.indexOf('E11000') !== -1));
}

async function injectFailure(options, point, details) {
    if (typeof options.failureInjector === 'function') {
        await options.failureInjector(point, details || {});
    }
}

function loadReviewedRun(options) {
    validateOptions(options);
    var source = inspectSource(options);
    var manifest = readManifest(options.manifestFile);
    var expectedRecords = validateManifest(manifest, source, options);
    return { source: source, manifest: manifest, expectedRecords: expectedRecords };
}

function dryRun(options, callback) {
    try {
        validateOptions(options);
        var source = inspectSource(options);
        var manifest = buildManifest(source, options);
        fs.writeFileSync(
            path.resolve(options.manifestFile),
            JSON.stringify(manifest, null, 2) + '\n',
            { encoding: 'utf8', flag: 'wx', mode: 0o600 }
        );
        callback(null, {
            manifest: manifest,
            manifestFile: path.resolve(options.manifestFile),
            totalSourceUsers: source.sourceManifest.count,
            validUsersCount: source.sourceManifest.count,
            collisions: source.collisions,
            invalidUsers: source.invalidUsers,
            success: true
        });
    } catch (error) {
        callback(error);
    }
}

function apply(options, callback) {
    var reviewed;
    try {
        reviewed = loadReviewedRun(options);
    } catch (error) {
        return callback(error);
    }

    (async function () {
        var client;
        try {
            try {
                client = await MongoClient.connect(options.mongoUrl);
            } catch (error) {
                throw new Error('Failed to connect to target database');
            }
            var db = client.db();
            var collection = db.collection('users');
            var evidenceCollection = db.collection('system_migrations');
            var manifest = reviewed.manifest;
            var expectedRecords = reviewed.expectedRecords;

            if (db.databaseName !== manifest.target.database) {
                throw new Error('Connected target database does not match the reviewed manifest identity');
            }
            var evidence = await evidenceCollection.findOne({ _id: EVIDENCE_ID });
            var resumed = !!evidence;
            if (evidence && !evidenceMatches(evidence, manifest)) {
                throw new Error('Existing migration evidence belongs to a divergent manifest run');
            }
            if (evidence && evidence.phase !== 'applying' && evidence.phase !== 'applied') {
                throw new Error('Existing migration evidence has an invalid durable phase');
            }
            await requireExactUsernameNormIndex(collection, !evidence || evidence.phase === 'applying');

            var targetBefore = await collection.find({}).toArray();
            var targetState = compareTarget(expectedRecords, targetBefore, true);
            if (targetState.mismatches.length) {
                throw new Error('Target divergence: ' + targetState.mismatches.join('; '));
            }

            if (evidence && evidence.phase === 'applied') {
                if (evidence.nextIndex !== expectedRecords.length ||
                        !Number.isSafeInteger(evidence.plannedAppliedAt) ||
                        evidence.appliedAt !== evidence.plannedAppliedAt) {
                    throw new Error('Existing migration evidence has invalid durable progress');
                }
                var completedMismatches = compareTarget(expectedRecords, targetBefore, false).mismatches;
                if (completedMismatches.length) {
                    throw new Error('Target divergence: ' + completedMismatches.join('; '));
                }
                return {
                    total: expectedRecords.length,
                    migrated: 0,
                    skipped: expectedRecords.length,
                    resumed: false,
                    replayed: true,
                    manifest: manifest
                };
            }
            if (!evidence) {
                var now = Date.now();
                evidence = {
                    _id: EVIDENCE_ID,
                    stateVersion: 1,
                    phase: 'applying',
                    runId: manifest.runId,
                    manifestDigest: manifest.manifestDigest,
                    manifest: manifest,
                    nextIndex: 0,
                    startedAt: now,
                    plannedAppliedAt: now
                };
                try {
                    await evidenceCollection.insertOne(evidence, DURABLE_WRITE);
                } catch (error) {
                    if (!isDuplicateKey(error)) throw error;
                    evidence = await evidenceCollection.findOne({ _id: EVIDENCE_ID });
                    resumed = true;
                    if (!evidenceMatches(evidence, manifest) || evidence.phase !== 'applying') {
                        throw new Error('Concurrent migration evidence belongs to a divergent manifest run');
                    }
                }
            }
            if (!Number.isSafeInteger(evidence.nextIndex) || evidence.nextIndex < 0 ||
                    evidence.nextIndex > expectedRecords.length ||
                    !Number.isSafeInteger(evidence.plannedAppliedAt)) {
                throw new Error('Existing migration evidence has invalid durable progress');
            }

            for (var prior = 0; prior < evidence.nextIndex; prior++) {
                if (!targetState.actual[expectedRecords[prior].usernameNorm]) {
                    throw new Error('Target divergence: durable progress references a missing target user');
                }
            }

            var migrated = 0;
            for (var index = 0; index < expectedRecords.length; index++) {
                var record = expectedRecords[index];
                if (!targetState.actual[record.usernameNorm]) {
                    await collection.insertOne(record, DURABLE_WRITE);
                    migrated++;
                    targetState.actual[record.usernameNorm] = record;
                    await injectFailure(options, 'after-user-write', { index: index, usernameNorm: record.usernameNorm });
                }
                if (evidence.nextIndex < index + 1) {
                    var progress = await evidenceCollection.updateOne({
                        _id: EVIDENCE_ID,
                        phase: 'applying',
                        manifestDigest: manifest.manifestDigest
                    }, { $set: { nextIndex: index + 1 } }, DURABLE_WRITE);
                    if (progress.matchedCount !== 1) throw new Error('Migration evidence progress update was rejected');
                    evidence.nextIndex = index + 1;
                }
            }

            var targetAfter = await collection.find({}).toArray();
            var mismatches = compareTarget(expectedRecords, targetAfter, false).mismatches;
            if (mismatches.length) throw new Error('Post-apply verification failed: ' + mismatches.join('; '));

            await injectFailure(options, 'before-evidence-finalize', {});
            var finalized = await evidenceCollection.updateOne({
                _id: EVIDENCE_ID,
                phase: 'applying',
                manifestDigest: manifest.manifestDigest,
                nextIndex: expectedRecords.length
            }, { $set: { phase: 'applied', appliedAt: evidence.plannedAppliedAt } }, DURABLE_WRITE);
            if (finalized.matchedCount !== 1) throw new Error('Migration evidence finalization was rejected');

            return {
                total: expectedRecords.length,
                migrated: migrated,
                skipped: expectedRecords.length - migrated,
                resumed: resumed,
                replayed: false,
                manifest: manifest
            };
        } finally {
            if (client) await client.close();
        }
    }()).then(function (stats) { callback(null, stats); }, callback);
}

function verify(options, callback) {
    var reviewed;
    try {
        reviewed = loadReviewedRun(options);
    } catch (error) {
        return callback(error);
    }

    (async function () {
        var client;
        try {
            try {
                client = await MongoClient.connect(options.mongoUrl);
            } catch (error) {
                throw new Error('Failed to connect to target database');
            }
            var db = client.db();
            if (db.databaseName !== reviewed.manifest.target.database) {
                throw new Error('Connected target database does not match the reviewed manifest identity');
            }
            var collection = db.collection('users');
            await requireExactUsernameNormIndex(collection, false);
            var evidence = await db.collection('system_migrations').findOne({ _id: EVIDENCE_ID });
            if (!evidence || evidence.phase !== 'applied') {
                throw new Error('Verification requires finalized apply evidence');
            }
            if (!evidenceMatches(evidence, reviewed.manifest)) {
                throw new Error('Finalized apply evidence does not match the exact reviewed manifest');
            }

            var targetRecords = await collection.find({}).toArray();
            var mismatches = compareTarget(reviewed.expectedRecords, targetRecords, false).mismatches;
            var targetManifest = transformedManifest(targetRecords
                .sort(function (left, right) {
                    return left.usernameNorm < right.usernameNorm ? -1 :
                        (left.usernameNorm > right.usernameNorm ? 1 : 0);
                }));
            if (!mismatches.length && targetManifest.digest !== reviewed.manifest.transformed.digest) {
                mismatches.push('Canonical target digest mismatch');
            }
            if (mismatches.length) {
                var error = new Error('Verification failed: ' + mismatches.join('; '));
                error.stats = {
                    total: reviewed.expectedRecords.length,
                    verified: 0,
                    mismatches: mismatches,
                    manifest: reviewed.manifest
                };
                throw error;
            }
            return {
                total: reviewed.expectedRecords.length,
                verified: reviewed.expectedRecords.length,
                mismatches: [],
                manifest: reviewed.manifest
            };
        } finally {
            if (client) await client.close();
        }
    }()).then(function (stats) { callback(null, stats); }, function (error) {
        callback(error, error.stats);
    });
}

function main() {
    var options;
    try {
        options = parseArgs();
    } catch (error) {
        console.error('ARGUMENT ERROR:', error.message);
        console.error(USAGE);
        process.exit(1);
    }

    if (options.mode === 'help') {
        console.log(USAGE);
        process.exit(0);
    }

    if (options.mode === 'dry-run') {
        dryRun(options, function (error, report) {
            if (error) {
                console.error('DRY RUN FAILED:', error.message);
                process.exit(1);
            }
            console.log(JSON.stringify(report.manifest, null, 2));
            console.log('DRY RUN SUCCESSFUL: reviewed manifest created at ' + report.manifestFile + '.');
            process.exit(0);
        });
    } else if (options.mode === 'apply') {
        apply(options, function (error, stats) {
            if (error) {
                console.error('MIGRATION APPLY FAILED:', error.message);
                process.exit(1);
            }
            console.log(JSON.stringify({
                runId: stats.manifest.runId,
                manifestDigest: stats.manifest.manifestDigest
            }, null, 2));
            console.log('MIGRATION COMPLETE: Migrated ' + stats.migrated + ' of ' + stats.total + ' users.');
            process.exit(0);
        });
    } else {
        verify(options, function (error, stats) {
            if (error) {
                console.error('VERIFICATION FAILED:', error.message);
                process.exit(1);
            }
            console.log(JSON.stringify({
                runId: stats.manifest.runId,
                manifestDigest: stats.manifest.manifestDigest
            }, null, 2));
            console.log('VERIFICATION SUCCESSFUL: ' + stats.verified + '/' + stats.total +
                ' users matched with canonical data integrity.');
            process.exit(0);
        });
    }
}

module.exports = {
    parseArgs: parseArgs,
    dryRun: dryRun,
    apply: apply,
    verify: verify,
    loadReviewedRun: loadReviewedRun
};

if (require.main === module) main();
