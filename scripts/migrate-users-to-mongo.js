#!/usr/bin/env node

/* jslint node:true */

'use strict';

var crypto = require('crypto'),
    fs = require('fs'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient;

var EVIDENCE_ID = 'users-file-to-mongo';
var USER_FIELDS = [
    'username', 'usernameNorm', 'displayName', 'email',
    'passwordHash', 'status', 'createdAt'
];
var USAGE = [
    'Usage: node scripts/migrate-users-to-mongo.js [--dry-run | --apply | --verify]',
    '  --users-file <path> --mongo-url <url>',
    '  [--expected-source-count <count> --expected-source-digest <sha256>]',
    '',
    '--apply and --verify require the expected count and digest printed by --dry-run.'
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

function nextArgument(args, index, name) {
    var value = args[index + 1];
    if (!value || value.indexOf('--') === 0) {
        throw new Error(name + ' requires a value');
    }
    return value;
}

function parseArgs(argv) {
    var args = argv || process.argv.slice(2);
    var options = { mode: null };
    var seen = {};

    function setOnce(name, value) {
        if (seen[name]) throw new Error('Duplicate argument: ' + name);
        seen[name] = true;
        options[value.key] = value.value;
    }

    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--dry-run' || arg === '--apply' || arg === '--verify') {
            var mode = arg.slice(2);
            if (options.mode) throw new Error('Exactly one migration mode is required');
            options.mode = mode;
        } else if (arg === '--users-file') {
            var usersFile = nextArgument(args, i, arg);
            setOnce(arg, { key: 'usersFile', value: path.resolve(usersFile) });
            i++;
        } else if (arg === '--mongo-url') {
            var mongoUrl = nextArgument(args, i, arg);
            setOnce(arg, { key: 'mongoUrl', value: mongoUrl });
            i++;
        } else if (arg === '--expected-source-count') {
            var count = nextArgument(args, i, arg);
            if (!/^[1-9][0-9]*$/.test(count)) {
                throw new Error('--expected-source-count must be a positive integer');
            }
            setOnce(arg, { key: 'expectedSourceCount', value: Number(count) });
            i++;
        } else if (arg === '--expected-source-digest') {
            var sourceDigest = nextArgument(args, i, arg);
            if (!/^[a-f0-9]{64}$/.test(sourceDigest)) {
                throw new Error('--expected-source-digest must be a lowercase SHA256 digest');
            }
            setOnce(arg, { key: 'expectedSourceDigest', value: sourceDigest });
            i++;
        } else if (arg === '--help' || arg === '-h') {
            if (args.length !== 1) throw new Error('--help cannot be combined with other arguments');
            return { mode: 'help' };
        } else {
            throw new Error('Unknown argument: ' + arg);
        }
    }

    if (!options.mode) throw new Error('Exactly one migration mode is required');
    validateOptions(options, options.mode);
    return options;
}

function validateOptions(options, mode) {
    if (!options || typeof options !== 'object') throw new Error('Migration options are required');
    if (!Object.prototype.hasOwnProperty.call(options, 'usersFile') ||
            typeof options.usersFile !== 'string' || !options.usersFile.trim()) {
        throw new Error('--users-file must explicitly identify the source');
    }
    if (!Object.prototype.hasOwnProperty.call(options, 'mongoUrl') ||
            typeof options.mongoUrl !== 'string' || !options.mongoUrl.trim()) {
        throw new Error('--mongo-url must explicitly identify the target');
    }

    if (mode === 'apply' || mode === 'verify') {
        if (!Number.isSafeInteger(options.expectedSourceCount) || options.expectedSourceCount <= 0) {
            throw new Error('--expected-source-count must be explicitly provided as a positive integer');
        }
        if (typeof options.expectedSourceDigest !== 'string' ||
                !/^[a-f0-9]{64}$/.test(options.expectedSourceDigest)) {
            throw new Error('--expected-source-digest must be explicitly provided as a lowercase SHA256 digest');
        }
    } else {
        if (options.expectedSourceCount !== undefined &&
                (!Number.isSafeInteger(options.expectedSourceCount) || options.expectedSourceCount <= 0)) {
            throw new Error('--expected-source-count must be a positive integer');
        }
        if (options.expectedSourceDigest !== undefined &&
                (typeof options.expectedSourceDigest !== 'string' ||
                !/^[a-f0-9]{64}$/.test(options.expectedSourceDigest))) {
            throw new Error('--expected-source-digest must be a lowercase SHA256 digest');
        }
    }
}

function readSourceUsers(usersFilePath) {
    var resolved = path.resolve(usersFilePath);
    var raw;
    var parsed;

    try {
        if (!fs.statSync(resolved).isFile()) throw new Error('not a regular file');
        raw = fs.readFileSync(resolved, 'utf8');
    } catch (error) {
        return {
            error: new Error('Failed to read users file ' + resolved + ': ' + error.message),
            users: null
        };
    }

    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        return { error: new Error('Failed to parse users file: ' + error.message), users: null };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: new Error('Source file does not contain a JSON user map'), users: null };
    }
    if (Object.keys(parsed).length === 0) {
        return { error: new Error('Source file contains an unexpected zero users'), users: null };
    }
    return { error: null, users: parsed, path: resolved };
}

function inspectSource(options) {
    var source = readSourceUsers(options.usersFile);
    if (source.error) throw source.error;

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
            collisions.push({
                norm: usernameNorm,
                first: normalized[usernameNorm],
                second: username
            });
        } else {
            normalized[usernameNorm] = username;
        }
    });

    if (collisions.length || invalidUsers.length) {
        var details = [];
        if (collisions.length) {
            details.push('Normalization collisions detected: ' + JSON.stringify(collisions));
        }
        if (invalidUsers.length) {
            details.push('Invalid user records detected: ' + invalidUsers.join(', '));
        }
        throw new Error(details.join('; '));
    }

    var manifest = { count: keys.length, digest: digest(source.users) };
    if (options.expectedSourceCount !== undefined &&
            options.expectedSourceCount !== manifest.count) {
        throw new Error(
            'Expected source count ' + options.expectedSourceCount +
            ' does not match actual source count ' + manifest.count
        );
    }
    if (options.expectedSourceDigest !== undefined &&
            options.expectedSourceDigest !== manifest.digest) {
        throw new Error(
            'Expected source digest ' + options.expectedSourceDigest +
            ' does not match actual source digest ' + manifest.digest
        );
    }

    return {
        users: source.users,
        usersFile: source.path,
        keys: keys,
        collisions: collisions,
        invalidUsers: invalidUsers,
        manifest: manifest
    };
}

function transformedUsers(source, defaultCreatedAt) {
    return source.keys.map(function (key) {
        var user = source.users[key];
        var username = user.username === undefined ? key : user.username;
        return {
            username: username,
            usernameNorm: username.toLowerCase(),
            displayName: user.displayName || username,
            email: user.email || '',
            passwordHash: user.passwordHash,
            status: 'active',
            createdAt: typeof user.createdAt === 'number' ? user.createdAt : defaultCreatedAt
        };
    }).sort(function (left, right) {
        return left.usernameNorm < right.usernameNorm ? -1 :
            (left.usernameNorm > right.usernameNorm ? 1 : 0);
    });
}

function transformedManifest(records) {
    return { count: records.length, digest: digest(records) };
}

function targetIdentity(mongoUrl) {
    return crypto.createHash('sha256').update(mongoUrl).digest('hex');
}

function evidenceMatches(evidence, source, options, databaseName) {
    return evidence && evidence.phase === 'applied' &&
        evidence.sourceIdentity === source.usersFile &&
        evidence.sourceCount === source.manifest.count &&
        evidence.sourceDigest === source.manifest.digest &&
        evidence.targetIdentity === targetIdentity(options.mongoUrl) &&
        evidence.targetDatabase === databaseName;
}

function compareTarget(expectedRecords, targetRecords) {
    var expected = Object.create(null);
    var actual = Object.create(null);
    var mismatches = [];

    expectedRecords.forEach(function (record) {
        expected[record.usernameNorm] = record;
    });
    targetRecords.forEach(function (record) {
        var identity = typeof record.usernameNorm === 'string' ?
            record.usernameNorm : String(record._id || '<unknown>');
        if (!expected[record.usernameNorm]) {
            mismatches.push('Unexpected target user ' + identity);
            return;
        }
        if (actual[record.usernameNorm]) {
            mismatches.push('Duplicate target user ' + identity);
            return;
        }
        actual[record.usernameNorm] = record;
    });

    expectedRecords.forEach(function (record) {
        var target = actual[record.usernameNorm];
        if (!target) {
            mismatches.push('Target user missing: ' + record.username);
            return;
        }
        USER_FIELDS.forEach(function (field) {
            if (!Object.prototype.hasOwnProperty.call(target, field) ||
                    stableJson(target[field]) !== stableJson(record[field])) {
                mismatches.push('Field mismatch for ' + record.username + ': ' + field);
            }
        });
    });

    if (targetRecords.length !== expectedRecords.length) {
        mismatches.push(
            'Target count mismatch: expected ' + expectedRecords.length +
            ', got ' + targetRecords.length
        );
    }
    return mismatches;
}

function dryRun(options, callback) {
    try {
        validateOptions(options, 'dry-run');
        var source = inspectSource(options);
        callback(null, {
            usersFile: source.usersFile,
            targetIdentity: targetIdentity(options.mongoUrl),
            totalSourceUsers: source.manifest.count,
            validUsersCount: source.manifest.count,
            collisions: source.collisions,
            invalidUsers: source.invalidUsers,
            manifest: source.manifest,
            success: true
        });
    } catch (error) {
        callback(error);
    }
}

function apply(options, callback) {
    var source;
    try {
        validateOptions(options, 'apply');
        source = inspectSource(options);
    } catch (error) {
        return callback(error);
    }

    (async function () {
        var client = await MongoClient.connect(options.mongoUrl);
        try {
            var db = client.db();
            var collection = db.collection('users');
            var evidenceCollection = db.collection('system_migrations');
            var existingEvidence = await evidenceCollection.findOne({ _id: EVIDENCE_ID });
            if (existingEvidence && !evidenceMatches(existingEvidence, source, options, db.databaseName)) {
                throw new Error('Existing apply evidence does not match the explicit source and target identities');
            }

            var defaultCreatedAt = existingEvidence ? existingEvidence.defaultCreatedAt : Date.now();
            var expectedRecords = transformedUsers(source, defaultCreatedAt);
            var expectedManifest = transformedManifest(expectedRecords);
            if (existingEvidence &&
                    (existingEvidence.transformedCount !== expectedManifest.count ||
                    existingEvidence.transformedDigest !== expectedManifest.digest)) {
                throw new Error('Existing apply evidence does not match the canonical transformed manifest');
            }

            var targetBefore = await collection.find({}).toArray();
            var unexpected = targetBefore.filter(function (record) {
                return !expectedRecords.some(function (expected) {
                    return expected.usernameNorm === record.usernameNorm;
                });
            });
            if (unexpected.length) {
                throw new Error('Unexpected target user ' +
                    (unexpected[0].usernameNorm || unexpected[0]._id));
            }

            try {
                await collection.createIndex({ usernameNorm: 1 }, { unique: true });
            } catch (indexError) {
                if (indexError.codeName !== 'IndexOptionsConflict') throw indexError;
            }

            for (var index = 0; index < expectedRecords.length; index++) {
                var record = expectedRecords[index];
                await collection.updateOne(
                    { usernameNorm: record.usernameNorm },
                    { $set: record },
                    { upsert: true }
                );
            }

            var targetAfter = await collection.find({}).toArray();
            var mismatches = compareTarget(expectedRecords, targetAfter);
            if (mismatches.length) {
                throw new Error('Post-apply verification failed: ' + mismatches.join('; '));
            }

            await evidenceCollection.updateOne({ _id: EVIDENCE_ID }, { $set: {
                phase: 'applied',
                sourceIdentity: source.usersFile,
                sourceCount: source.manifest.count,
                sourceDigest: source.manifest.digest,
                targetIdentity: targetIdentity(options.mongoUrl),
                targetDatabase: db.databaseName,
                defaultCreatedAt: defaultCreatedAt,
                transformedCount: expectedManifest.count,
                transformedDigest: expectedManifest.digest,
                appliedAt: Date.now()
            } }, { upsert: true });

            return {
                total: expectedRecords.length,
                migrated: expectedRecords.length,
                skipped: 0,
                manifest: expectedManifest
            };
        } finally {
            await client.close();
        }
    }()).then(function (stats) { callback(null, stats); }, callback);
}

function verify(options, callback) {
    var source;
    try {
        validateOptions(options, 'verify');
        source = inspectSource(options);
    } catch (error) {
        return callback(error);
    }

    (async function () {
        var client = await MongoClient.connect(options.mongoUrl);
        try {
            var db = client.db();
            var evidence = await db.collection('system_migrations').findOne({ _id: EVIDENCE_ID });
            if (!evidence) throw new Error('Verification requires matching apply evidence');
            if (!evidenceMatches(evidence, source, options, db.databaseName)) {
                throw new Error('Apply evidence does not match the explicit source and target identities');
            }

            var expectedRecords = transformedUsers(source, evidence.defaultCreatedAt);
            var expectedManifest = transformedManifest(expectedRecords);
            if (evidence.transformedCount !== expectedManifest.count ||
                    evidence.transformedDigest !== expectedManifest.digest) {
                throw new Error('Apply evidence does not match the canonical transformed manifest');
            }

            var targetRecords = await db.collection('users').find({}).toArray();
            var mismatches = compareTarget(expectedRecords, targetRecords);
            var targetManifest = transformedManifest(targetRecords.map(function (record) {
                var canonical = {};
                USER_FIELDS.forEach(function (field) { canonical[field] = record[field]; });
                return canonical;
            }).sort(function (left, right) {
                return left.usernameNorm < right.usernameNorm ? -1 :
                    (left.usernameNorm > right.usernameNorm ? 1 : 0);
            }));

            if (mismatches.length || targetManifest.digest !== expectedManifest.digest) {
                if (!mismatches.length) mismatches.push('Canonical target digest mismatch');
                var error = new Error('Verification failed: ' + mismatches.join('; '));
                error.stats = {
                    total: expectedRecords.length,
                    verified: expectedRecords.length - mismatches.length,
                    mismatches: mismatches,
                    manifest: expectedManifest
                };
                throw error;
            }

            return {
                total: expectedRecords.length,
                verified: expectedRecords.length,
                mismatches: [],
                manifest: expectedManifest
            };
        } finally {
            await client.close();
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
            console.log('DRY RUN SUCCESSFUL: explicit source and target identities validated.');
            process.exit(0);
        });
    } else if (options.mode === 'apply') {
        apply(options, function (error, stats) {
            if (error) {
                console.error('MIGRATION APPLY FAILED:', error.message);
                process.exit(1);
            }
            console.log(JSON.stringify(stats.manifest, null, 2));
            console.log('MIGRATION COMPLETE: Migrated ' + stats.migrated + ' of ' + stats.total + ' users.');
            process.exit(0);
        });
    } else {
        verify(options, function (error, stats) {
            if (error) {
                console.error('VERIFICATION FAILED:', error.message);
                process.exit(1);
            }
            console.log(JSON.stringify(stats.manifest, null, 2));
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
    verify: verify
};

if (require.main === module) main();
