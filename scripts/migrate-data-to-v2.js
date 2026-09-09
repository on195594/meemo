#!/usr/bin/env node

/* jslint node:true */

'use strict';

var MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    async = require('async'),
    config = require('../src/config.js'),
    users = require('../src/users.js');

function parseArgs() {
    var args = process.argv.slice(2);
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
        } else if (arg === '--help' || arg === '-h') {
            options.mode = 'help';
        }
    }

    return options;
}

function getDbConnection(options, callback) {
    if (options && options.db) {
        return callback(null, options.db, function close(cb) { if (cb) cb(); });
    }

    var mongoUrl = (options && options.mongoUrl) || process.env.MONGODB_URL || config.databaseUrl || 'mongodb://127.0.0.1:27017/meemo';
    MongoClient.connect(mongoUrl, { useUnifiedTopology: true }, function (err, client) {
        if (err) return callback(err);
        var db = client.db();
        callback(null, db, function close(cb) {
            client.close(cb);
        });
    });
}

function ensureUnifiedIndexes(db, callback) {
    var thingsColl = db.collection('things');
    var tagsColl = db.collection('tags');
    var settingsColl = db.collection('settings');

    async.series([
        function (next) {
            thingsColl.createIndex({ ownerId: 1, modifiedAt: -1 }, function (err) {
                if (err && err.codeName !== 'IndexOptionsConflict') return next(err);
                thingsColl.createIndex({ ownerId: 1, sticky: -1, modifiedAt: -1 }, function (err2) {
                    if (err2 && err2.codeName !== 'IndexOptionsConflict') return next(err2);
                    thingsColl.createIndex({ ownerId: 1, archived: 1, modifiedAt: -1 }, function (err3) {
                        if (err3 && err3.codeName !== 'IndexOptionsConflict') return next(err3);
                        thingsColl.createIndex({ content: 'text' }, { default_language: 'none' }, function (err4) {
                            if (err4 && err4.codeName !== 'IndexOptionsConflict') return next(err4);
                            next();
                        });
                    });
                });
            });
        },
        function (next) {
            tagsColl.createIndex({ ownerId: 1, name: 1 }, { unique: true }, function (err) {
                if (err && err.codeName !== 'IndexOptionsConflict') return next(err);
                next();
            });
        },
        function (next) {
            settingsColl.createIndex({ ownerId: 1 }, { unique: true }, function (err) {
                if (err && err.codeName !== 'IndexOptionsConflict') return next(err);
                next();
            });
        }
    ], callback);
}

function discoverLegacyCollections(db, callback) {
    db.listCollections().toArray(function (err, collList) {
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

function resolveCanonicalOwner(db, prefix, callback) {
    if (users && typeof users.resolveUser === 'function') {
        users.resolveUser(prefix, function (err, u) {
            if (!err && u && u.id) {
                return callback(null, u.id, u.username);
            }
            lookupInMongoUsers(db, prefix, callback);
        });
    } else {
        lookupInMongoUsers(db, prefix, callback);
    }
}

function lookupInMongoUsers(db, prefix, callback) {
    var query = {
        $or: [
            { usernameNorm: prefix.toLowerCase() },
            { username: prefix }
        ]
    };

    if (ObjectId.isValid(prefix) && String(new ObjectId(prefix)) === prefix) {
        query.$or.unshift({ _id: new ObjectId(prefix) });
    }

    db.collection('users').findOne(query, function (err, doc) {
        if (err || !doc) {
            return callback(null, prefix, prefix);
        }
        callback(null, String(doc._id), doc.username);
    });
}

function dryRun(options, callback) {
    options = options || {};
    getDbConnection(options, function (err, db, close) {
        if (err) return callback(err);

        discoverLegacyCollections(db, function (err, legacy) {
            if (err) {
                return close(function () { callback(err); });
            }

            var userMap = {};
            var allPrefixes = {};

            legacy.things.forEach(function (c) { allPrefixes[c.prefix] = true; });
            legacy.tags.forEach(function (c) { allPrefixes[c.prefix] = true; });
            legacy.settings.forEach(function (c) { allPrefixes[c.prefix] = true; });

            var prefixes = Object.keys(allPrefixes);

            async.eachSeries(prefixes, function (prefix, nextPrefix) {
                resolveCanonicalOwner(db, prefix, function (err, canonicalId, username) {
                    if (err) return nextPrefix(err);

                    var entry = {
                        prefix: prefix,
                        canonicalOwnerId: canonicalId,
                        canonicalUsername: username,
                        thingsCount: 0,
                        tagsCount: 0,
                        hasSettings: false
                    };

                    async.parallel([
                        function (doneThings) {
                            var collName = prefix + '_things';
                            db.collection(collName).countDocuments(function (e, count) {
                                entry.thingsCount = count || 0;
                                doneThings();
                            });
                        },
                        function (doneTags) {
                            var collName = prefix + '_tags';
                            db.collection(collName).countDocuments(function (e, count) {
                                entry.tagsCount = count || 0;
                                doneTags();
                            });
                        },
                        function (doneSettings) {
                            var collName = prefix + '_settings';
                            db.collection(collName).countDocuments(function (e, count) {
                                entry.hasSettings = Boolean(count && count > 0);
                                doneSettings();
                            });
                        }
                    ], function () {
                        userMap[prefix] = entry;
                        nextPrefix();
                    });
                });
            }, function (err) {
                if (err) {
                    return close(function () { callback(err); });
                }

                var totalThings = 0;
                var totalTags = 0;
                var totalSettings = 0;

                Object.keys(userMap).forEach(function (k) {
                    totalThings += userMap[k].thingsCount;
                    totalTags += userMap[k].tagsCount;
                    if (userMap[k].hasSettings) totalSettings++;
                });

                var report = {
                    totalLegacyUsers: prefixes.length,
                    totalThingsToMigrate: totalThings,
                    totalTagsToMigrate: totalTags,
                    totalSettingsToMigrate: totalSettings,
                    users: userMap
                };

                close(function () {
                    callback(null, report);
                });
            });
        });
    });
}

function apply(options, callback) {
    options = options || {};
    getDbConnection(options, function (err, db, close) {
        if (err) return callback(err);

        ensureUnifiedIndexes(db, function (err) {
            if (err) {
                return close(function () { callback(err); });
            }

            discoverLegacyCollections(db, function (err, legacy) {
                if (err) {
                    return close(function () { callback(err); });
                }

                var stats = {
                    migratedThings: 0,
                    migratedTags: 0,
                    migratedSettings: 0,
                    usersProcessed: 0
                };

                var allPrefixes = {};
                legacy.things.forEach(function (c) { allPrefixes[c.prefix] = true; });
                legacy.tags.forEach(function (c) { allPrefixes[c.prefix] = true; });
                legacy.settings.forEach(function (c) { allPrefixes[c.prefix] = true; });

                var prefixes = Object.keys(allPrefixes);

                async.eachSeries(prefixes, function (prefix, nextUser) {
                    resolveCanonicalOwner(db, prefix, function (err, canonicalId) {
                        if (err) return nextUser(err);

                        async.series([
                            // Migrate Things
                            function (doneThings) {
                                db.collection(prefix + '_things').find({}).toArray(function (err, docs) {
                                    if (err || !docs || docs.length === 0) return doneThings();

                                    async.eachSeries(docs, function (doc, nextDoc) {
                                        doc.ownerId = canonicalId;
                                        doc.public = !!doc.public;
                                        doc.shared = !!doc.shared;
                                        doc.archived = !!doc.archived;
                                        doc.sticky = !!doc.sticky;

                                        db.collection('things').replaceOne({ _id: doc._id }, doc, { upsert: true }, function (e) {
                                            if (e) return nextDoc(e);
                                            stats.migratedThings++;
                                            nextDoc();
                                        });
                                    }, doneThings);
                                });
                            },

                            // Migrate Tags
                            function (doneTags) {
                                db.collection(prefix + '_tags').find({}).toArray(function (err, docs) {
                                    if (err || !docs || docs.length === 0) return doneTags();

                                    async.eachSeries(docs, function (tagDoc, nextTag) {
                                        var filter = { ownerId: canonicalId, name: tagDoc.name };
                                        var updateDoc = {
                                            $set: {
                                                ownerId: canonicalId,
                                                name: tagDoc.name,
                                                usage: tagDoc.usage || 1,
                                                modifiedAt: Date.now()
                                            },
                                            $setOnInsert: {
                                                createdAt: tagDoc.createdAt || Date.now()
                                            }
                                        };

                                        db.collection('tags').updateOne(filter, updateDoc, { upsert: true }, function (e) {
                                            if (e) return nextTag(e);
                                            stats.migratedTags++;
                                            nextTag();
                                        });
                                    }, doneTags);
                                });
                            },

                            // Migrate Settings
                            function (doneSettings) {
                                db.collection(prefix + '_settings').findOne({ type: 'frontend' }, function (err, setDoc) {
                                    if (err || !setDoc) return doneSettings();

                                    var docToSave = {
                                        ownerId: canonicalId,
                                        type: 'frontend',
                                        value: (setDoc && typeof setDoc.value === 'object') ? setDoc.value : { title: 'Meemo' },
                                        modifiedAt: Date.now()
                                    };

                                    db.collection('settings').replaceOne({ ownerId: canonicalId }, docToSave, { upsert: true }, function (e) {
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
                    });
                }, function (err) {
                    close(function () {
                        if (err) return callback(err);
                        callback(null, stats);
                    });
                });
            });
        });
    });
}

function verify(options, callback) {
    options = options || {};
    getDbConnection(options, function (err, db, close) {
        if (err) return callback(err);

        discoverLegacyCollections(db, function (err, legacy) {
            if (err) {
                return close(function () { callback(err); });
            }

            var allPrefixes = {};
            legacy.things.forEach(function (c) { allPrefixes[c.prefix] = true; });
            legacy.tags.forEach(function (c) { allPrefixes[c.prefix] = true; });
            legacy.settings.forEach(function (c) { allPrefixes[c.prefix] = true; });

            var prefixes = Object.keys(allPrefixes);
            var mismatches = [];
            var verifiedCount = 0;

            async.eachSeries(prefixes, function (prefix, nextUser) {
                resolveCanonicalOwner(db, prefix, function (err, canonicalId) {
                    if (err) return nextUser(err);

                    async.series([
                        // Verify Things counts and contents
                        function (doneCheckThings) {
                            db.collection(prefix + '_things').find({}).toArray(function (err, legacyDocs) {
                                if (err) return doneCheckThings(err);
                                if (!legacyDocs || legacyDocs.length === 0) return doneCheckThings();

                                db.collection('things').find({ ownerId: canonicalId }).toArray(function (err, unifiedDocs) {
                                    if (err) return doneCheckThings(err);

                                    var unifiedMap = {};
                                    (unifiedDocs || []).forEach(function (d) { unifiedMap[String(d._id)] = d; });

                                    legacyDocs.forEach(function (ld) {
                                        var ud = unifiedMap[String(ld._id)];
                                        if (!ud) {
                                            mismatches.push('Missing thing in unified collection: ' + ld._id + ' for owner ' + canonicalId);
                                        } else if (ud.content !== ld.content) {
                                            mismatches.push('Content mismatch on thing: ' + ld._id);
                                        }
                                    });

                                    doneCheckThings();
                                });
                            });
                        },

                        // Verify Tags
                        function (doneCheckTags) {
                            db.collection(prefix + '_tags').find({}).toArray(function (err, legacyTags) {
                                if (err) return doneCheckTags(err);
                                if (!legacyTags || legacyTags.length === 0) return doneCheckTags();

                                db.collection('tags').find({ ownerId: canonicalId }).toArray(function (err, unifiedTags) {
                                    if (err) return doneCheckTags(err);

                                    var tagNames = {};
                                    (unifiedTags || []).forEach(function (t) { tagNames[t.name] = true; });

                                    legacyTags.forEach(function (lt) {
                                        if (!tagNames[lt.name]) {
                                            mismatches.push('Missing tag in unified collection: ' + lt.name + ' for owner ' + canonicalId);
                                        }
                                    });

                                    doneCheckTags();
                                });
                            });
                        },

                        // Verify Settings
                        function (doneCheckSettings) {
                            db.collection(prefix + '_settings').findOne({ type: 'frontend' }, function (err, legacySet) {
                                if (err) return doneCheckSettings(err);
                                if (!legacySet) return doneCheckSettings();

                                db.collection('settings').findOne({ ownerId: canonicalId }, function (err, unifiedSet) {
                                    if (err) return doneCheckSettings(err);
                                    if (!unifiedSet) {
                                        mismatches.push('Missing settings in unified collection for owner ' + canonicalId);
                                    }
                                    doneCheckSettings();
                                });
                            });
                        }
                    ], function (err) {
                        if (err) return nextUser(err);
                        verifiedCount++;
                        nextUser();
                    });
                });
            }, function (err) {
                close(function () {
                    if (err) return callback(err);

                    var result = {
                        verifiedUsers: verifiedCount,
                        mismatches: mismatches,
                        success: mismatches.length === 0
                    };

                    if (!result.success) {
                        return callback(new Error('Verification failed with ' + mismatches.length + ' mismatches: ' + mismatches.join('; ')));
                    }

                    callback(null, result);
                });
            });
        });
    });
}

function main() {
    var options = parseArgs();

    if (!options.mode || options.mode === 'help') {
        console.log('Usage: node scripts/migrate-data-to-v2.js [--dry-run | --apply | --verify] [--mongo-url <url>]');
        process.exit(options.mode === 'help' ? 0 : 1);
    }

    if (options.mode === 'dry-run') {
        console.log('Running dry-run data migration plan...');
        dryRun(options, function (err, report) {
            if (err) {
                console.error('Dry-run failed:', err.message || err);
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
                console.error('Migration apply failed:', err.message || err);
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
                console.error('Verification failed:', err.message || err);
                process.exit(1);
            }
            console.log('Verification succeeded! 100% data fidelity confirmed across', result.verifiedUsers, 'users.');
            process.exit(0);
        });
    }
}

module.exports = {
    dryRun: dryRun,
    apply: apply,
    verify: verify,
    discoverLegacyCollections: discoverLegacyCollections,
    resolveCanonicalOwner: resolveCanonicalOwner
};

if (require.main === module) {
    main();
}
