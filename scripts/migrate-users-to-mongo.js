#!/usr/bin/env node

/* jslint node:true */

'use strict';

var fs = require('fs'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient;

function parseArgs() {
    var args = process.argv.slice(2);
    var options = {
        mode: null,
        usersFile: process.env.USERS_FILE || path.resolve('.users.json'),
        mongoUrl: process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/meemo'
    };

    for (var i = 0; i < args.length; i++) {
        var arg = args[i];
        if (arg === '--dry-run') options.mode = 'dry-run';
        else if (arg === '--apply') options.mode = 'apply';
        else if (arg === '--verify') options.mode = 'verify';
        else if (arg === '--users-file' && args[i + 1]) {
            options.usersFile = path.resolve(args[++i]);
        } else if (arg === '--mongo-url' && args[i + 1]) {
            options.mongoUrl = args[++i];
        } else if (arg === '--help' || arg === '-h') {
            options.mode = 'help';
        }
    }

    return options;
}

function readSourceUsers(usersFilePath) {
    if (!fs.existsSync(usersFilePath)) {
        return { error: null, users: {} };
    }

    try {
        var raw = fs.readFileSync(usersFilePath, 'utf8');
        var parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { error: new Error('Source file does not contain a JSON user map'), users: null };
        }
        return { error: null, users: parsed };
    } catch (e) {
        return { error: new Error('Failed to read or parse users file: ' + e.message), users: null };
    }
}

function dryRun(options, callback) {
    var usersFilePath = options.usersFile || process.env.USERS_FILE || path.resolve('.users.json');
    var result = readSourceUsers(usersFilePath);

    if (result.error) return callback(result.error);

    var sourceUsers = result.users;
    var usernames = Object.keys(sourceUsers);
    var normMap = {};
    var collisions = [];
    var invalidUsers = [];

    usernames.forEach(function (key) {
        var u = sourceUsers[key];
        if (!u || typeof u !== 'object') {
            invalidUsers.push(key);
            return;
        }

        var username = u.username || key;
        var norm = username.toLowerCase();

        if (!u.passwordHash || typeof u.passwordHash !== 'string') {
            invalidUsers.push(username + ' (missing passwordHash)');
        }

        if (normMap[norm]) {
            collisions.push({ norm: norm, first: normMap[norm], second: username });
        } else {
            normMap[norm] = username;
        }
    });

    var report = {
        usersFile: usersFilePath,
        totalSourceUsers: usernames.length,
        validUsersCount: usernames.length - invalidUsers.length,
        collisions: collisions,
        invalidUsers: invalidUsers,
        success: collisions.length === 0 && invalidUsers.length === 0
    };

    if (!report.success) {
        var errMsg = [];
        if (collisions.length > 0) {
            errMsg.push('Normalization collisions detected: ' + JSON.stringify(collisions));
        }
        if (invalidUsers.length > 0) {
            errMsg.push('Invalid user records detected: ' + invalidUsers.join(', '));
        }
        return callback(new Error(errMsg.join('; ')), report);
    }

    callback(null, report);
}

function apply(options, callback) {
    var usersFilePath = options.usersFile || process.env.USERS_FILE || path.resolve('.users.json');
    var mongoUrl = options.mongoUrl || process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/meemo';

    dryRun(options, function (err, dryReport) {
        if (err) return callback(err);

        var result = readSourceUsers(usersFilePath);
        var sourceUsers = result.users;
        var keys = Object.keys(sourceUsers);

        MongoClient.connect(mongoUrl, { useUnifiedTopology: true }, function (err, client) {
            if (err) return callback(err);

            var db = client.db();
            var collection = db.collection('users');

            collection.createIndex({ usernameNorm: 1 }, { unique: true }, function (err) {
                if (err && err.codeName !== 'IndexOptionsConflict') {
                    client.close();
                    return callback(err);
                }

                var migratedCount = 0;
                var skippedCount = 0;

                var processNext = function (index) {
                    if (index >= keys.length) {
                        client.close(function () {
                            callback(null, {
                                total: keys.length,
                                migrated: migratedCount,
                                skipped: skippedCount
                            });
                        });
                        return;
                    }

                    var key = keys[index];
                    var u = sourceUsers[key];
                    var username = u.username || key;
                    var usernameNorm = username.toLowerCase();

                    var updateDoc = {
                        $set: {
                            username: username,
                            usernameNorm: usernameNorm,
                            displayName: u.displayName || username,
                            email: u.email || '',
                            passwordHash: u.passwordHash,
                            status: 'active'
                        },
                        $setOnInsert: {
                            createdAt: typeof u.createdAt === 'number' ? u.createdAt : Date.now()
                        }
                    };

                    collection.updateOne({ usernameNorm: usernameNorm }, updateDoc, { upsert: true }, function (err) {
                        if (err) {
                            client.close();
                            return callback(err);
                        }
                        migratedCount++;
                        processNext(index + 1);
                    });
                };

                processNext(0);
            });
        });
    });
}

function verify(options, callback) {
    var usersFilePath = options.usersFile || process.env.USERS_FILE || path.resolve('.users.json');
    var mongoUrl = options.mongoUrl || process.env.MONGODB_URL || 'mongodb://127.0.0.1:27017/meemo';

    var result = readSourceUsers(usersFilePath);
    if (result.error) return callback(result.error);

    var sourceUsers = result.users;
    var sourceKeys = Object.keys(sourceUsers);

    MongoClient.connect(mongoUrl, { useUnifiedTopology: true }, function (err, client) {
        if (err) return callback(err);

        var db = client.db();
        var collection = db.collection('users');

        var mismatches = [];
        var verifiedCount = 0;

        var checkNext = function (index) {
            if (index >= sourceKeys.length) {
                client.close(function () {
                    if (mismatches.length > 0) {
                        return callback(new Error('Verification failed: ' + mismatches.join('; ')), {
                            total: sourceKeys.length,
                            verified: verifiedCount,
                            mismatches: mismatches
                        });
                    }

                    callback(null, {
                        total: sourceKeys.length,
                        verified: verifiedCount,
                        mismatches: []
                    });
                });
                return;
            }

            var key = sourceKeys[index];
            var src = sourceUsers[key];
            var username = src.username || key;
            var usernameNorm = username.toLowerCase();

            collection.findOne({ usernameNorm: usernameNorm }, function (err, doc) {
                if (err) {
                    client.close();
                    return callback(err);
                }

                if (!doc) {
                    mismatches.push('User ' + username + ' missing from MongoDB');
                } else {
                    if (doc.username !== username) {
                        mismatches.push('Username mismatch for ' + username + ': expected ' + username + ', got ' + doc.username);
                    }
                    if (doc.passwordHash !== src.passwordHash) {
                        mismatches.push('PasswordHash mismatch for ' + username);
                    }
                    if (src.email && doc.email !== src.email) {
                        mismatches.push('Email mismatch for ' + username + ': expected ' + src.email + ', got ' + doc.email);
                    }
                    if (src.displayName && doc.displayName !== src.displayName) {
                        mismatches.push('DisplayName mismatch for ' + username + ': expected ' + src.displayName + ', got ' + doc.displayName);
                    }
                }

                verifiedCount++;
                checkNext(index + 1);
            });
        };

        checkNext(0);
    });
}

if (require.main === module) {
    var opts = parseArgs();

    if (!opts.mode || opts.mode === 'help') {
        console.log('Usage: node scripts/migrate-users-to-mongo.js [--dry-run | --apply | --verify] [--users-file <path>] [--mongo-url <url>]');
        process.exit(opts.mode === 'help' ? 0 : 1);
    }

    if (opts.mode === 'dry-run') {
        console.log('Starting user migration dry-run...');
        dryRun(opts, function (err, report) {
            if (err) {
                console.error('DRY RUN FAILED:', err.message);
                process.exit(1);
            }
            console.log('Source file:', report.usersFile);
            console.log('Total source users:', report.totalSourceUsers);
            console.log('Valid users:', report.validUsersCount);
            console.log('DRY RUN SUCCESSFUL: No collisions or structural defects found.');
            process.exit(0);
        });
    } else if (opts.mode === 'apply') {
        console.log('Applying user migration to MongoDB...');
        apply(opts, function (err, stats) {
            if (err) {
                console.error('MIGRATION APPLY FAILED:', err.message);
                process.exit(1);
            }
            console.log('MIGRATION COMPLETE: Migrated ' + stats.migrated + ' of ' + stats.total + ' users.');
            process.exit(0);
        });
    } else if (opts.mode === 'verify') {
        console.log('Verifying user migration integrity...');
        verify(opts, function (err, stats) {
            if (err) {
                console.error('VERIFICATION FAILED:', err.message);
                process.exit(1);
            }
            console.log('VERIFICATION SUCCESSFUL: ' + stats.verified + '/' + stats.total + ' users matched with 100% data integrity.');
            process.exit(0);
        });
    }
}

module.exports = {
    dryRun: dryRun,
    apply: apply,
    verify: verify
};
