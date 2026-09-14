'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var childProcess = require('child_process');
var fs = require('fs');
var os = require('os');
var path = require('path');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var config = require('../config.js');
var users = require('../users.js');
var migrator = require('../../scripts/migrate-data-to-v2.js');
var sourceExpectations = require('./migration-expected-source.js');

var PREFIX = 'rf706_user';
var ALIAS_PREFIX = 'rf706_alias';
var THING_ID = new ObjectId('000000000000000000000701');
var OTHER_THING_ID = new ObjectId('000000000000000000000702');
var ALIAS_THING_ID = new ObjectId('000000000000000000000703');
var ZETA_TAG_ID = new ObjectId('000000000000000000000704');
var ALPHA_TAG_ID = new ObjectId('000000000000000000000705');
var SETTINGS_ID = new ObjectId('000000000000000000000706');
var THING_DATE = new Date('2020-01-02T03:04:05.000Z');
var sourceDocuments;

function callbackPromise(invoke) {
    return new Promise(function (resolve, reject) {
        invoke(function (error, result) {
            if (error) return reject(error);
            resolve(result);
        });
    });
}

async function verificationResult(db, aliasDocuments) {
    var documents = Object.assign({}, sourceDocuments);
    if (aliasDocuments) documents[ALIAS_PREFIX + '_things'] = aliasDocuments;
    var expectedSource = sourceExpectations.expectedSource(
        documents, null, db.databaseName
    );
    await db.collection('system_migrations').updateOne(
        { _id: 'schema-v2' },
        { $set: { sourceEvidenceDigest: sourceExpectations.digest(expectedSource) } }
    );
    var artifact = sourceExpectations.writeArtifact(expectedSource);
    try {
        return await new Promise(function (resolve) {
            migrator.verify({
                db: db,
                expectedDatabase: db.databaseName,
                expectedSourceFile: artifact
            }, function (error, result) {
                resolve({ error: error, result: result });
            });
        });
    } finally {
        sourceExpectations.removeArtifact(artifact);
    }
}

describe('Canonical migration verification (RF-706)', function () {
    this.timeout(20000);

    var client;
    var db;
    var originalRepository;
    var baselineThings;
    var baselineTags;
    var baselineSettings;

    function restoreTargets() {
        return Promise.all([
            db.collection('things').deleteMany({ ownerId: PREFIX }).then(function () {
                return db.collection('things').insertMany(baselineThings);
            }),
            db.collection('tags').deleteMany({ ownerId: PREFIX }).then(function () {
                return db.collection('tags').insertMany(baselineTags);
            }),
            db.collection('settings').deleteMany({ ownerId: PREFIX }).then(function () {
                return db.collection('settings').insertOne(baselineSettings);
            })
        ]);
    }

    before(function () {
        originalRepository = users.getRepository();
        users.setRepository({
            get: function () {
                return Promise.resolve({ id: PREFIX, username: PREFIX });
            }
        });

        return callbackPromise(function (done) { config._clearDatabase(done); })
            .then(function () {
                return MongoClient.connect(config.databaseUrl);
            }).then(function (connected) {
                client = connected;
                db = client.db();
                sourceDocuments = {};
                sourceDocuments[PREFIX + '_things'] = [
                    {
                        _id: OTHER_THING_ID,
                        content: 'Second note',
                        createdAt: 2000,
                        modifiedAt: 2500,
                        attachments: [],
                        externalContent: [],
                        public: false,
                        shared: true,
                        archived: false,
                        sticky: true
                    },
                    {
                        _id: THING_ID,
                        content: 'First note',
                        createdAt: THING_DATE,
                        modifiedAt: 1500,
                        attachments: [{ identifier: 'attachment-1', meta: { z: 2, a: 1 } }],
                        externalContent: [{ url: 'https://example.test', meta: { z: 2, a: 1 } }],
                        public: true,
                        shared: false,
                        archived: true,
                        sticky: false
                    }
                ];
                sourceDocuments[PREFIX + '_tags'] = [
                    { _id: ZETA_TAG_ID, name: 'zeta', usage: 2, createdAt: 2200 },
                    { _id: ALPHA_TAG_ID, name: 'alpha', usage: 5, createdAt: 1100 }
                ];
                sourceDocuments[PREFIX + '_settings'] = [{
                    _id: SETTINGS_ID,
                    type: 'frontend',
                    value: {
                        title: 'RF-706',
                        nested: { z: 2, a: 1 },
                        list: [{ z: 2, a: 1 }]
                    }
                }];
                return Promise.all([
                    db.collection(PREFIX + '_things').insertMany(sourceDocuments[PREFIX + '_things']),
                    db.collection(PREFIX + '_tags').insertMany(sourceDocuments[PREFIX + '_tags']),
                    db.collection(PREFIX + '_settings').insertMany(sourceDocuments[PREFIX + '_settings'])
                ]);
            }).then(function () {
                return sourceExpectations.expectedSource(
                    sourceDocuments, null, db.databaseName
                );
            }).then(function (expectedSource) {
                var artifact = sourceExpectations.writeArtifact(expectedSource);
                return callbackPromise(function (done) {
                    migrator.apply({
                        db: db,
                        expectedDatabase: db.databaseName,
                        expectedSourceFile: artifact
                    }, done);
                }).finally(function () { sourceExpectations.removeArtifact(artifact); });
            }).then(function () {
                return Promise.all([
                    db.collection('things').find({ ownerId: PREFIX }).toArray(),
                    db.collection('tags').find({ ownerId: PREFIX }).toArray(),
                    db.collection('settings').findOne({ ownerId: PREFIX })
                ]);
            }).then(function (targets) {
                baselineThings = targets[0];
                baselineTags = targets[1];
                baselineSettings = targets[2];
                return db.collection('system_migrations').updateOne(
                    { _id: 'schema-v2' },
                    { $set: { phase: 'complete' } }
                );
            });
    });

    after(function () {
        users.setRepository(originalRepository);
        return callbackPromise(function (done) { config._clearDatabase(done); })
            .then(function () { return client.close(); });
    });

    it('passes identical data and returns deterministic sorted SHA256 manifests', function () {
        var firstManifest;

        return verificationResult(db).then(function (outcome) {
            if (outcome.error) throw outcome.error;
            expect(outcome.result.success).to.be(true);
            expect(outcome.result.manifest.thingsCount).to.equal(2);
            expect(outcome.result.manifest.tagsCount).to.equal(2);
            expect(outcome.result.manifest.thingsHash).to.match(/^[a-f0-9]{64}$/);
            expect(outcome.result.manifest.tagsHash).to.match(/^[a-f0-9]{64}$/);
            expect(outcome.result.manifest.settingsHash).to.match(/^[a-f0-9]{64}$/);
            firstManifest = outcome.result.manifest;

            return Promise.all([
                db.collection('things').deleteMany({ ownerId: PREFIX }).then(function () {
                    return db.collection('things').insertMany(baselineThings.slice().reverse());
                }),
                db.collection('tags').deleteMany({ ownerId: PREFIX }).then(function () {
                    return db.collection('tags').insertMany(baselineTags.slice().reverse());
                }),
                db.collection('settings').replaceOne({ ownerId: PREFIX }, {
                    ownerId: PREFIX,
                    type: 'frontend',
                    value: {
                        list: [{ a: 1, z: 2 }],
                        nested: { a: 1, z: 2 },
                        title: 'RF-706'
                    },
                    modifiedAt: baselineSettings.modifiedAt
                })
            ]);
        }).then(function () {
            return verificationResult(db);
        }).then(function (outcome) {
            if (outcome.error) throw outcome.error;
            expect(outcome.result.manifest).to.eql(firstManifest);
        });
    });

    var mismatchCases = [
        { entity: 'thing', id: String(THING_ID), field: '_id', mutate: function (db) {
            return db.collection('things').deleteOne({ _id: THING_ID }).then(function () {
                return db.collection('things').insertOne(Object.assign({}, baselineThings.find(function (thing) {
                    return String(thing._id) === String(THING_ID);
                }), { _id: String(THING_ID) }));
            });
        } },
        { entity: 'thing', id: String(THING_ID), field: 'content', update: { content: 'corrupt' } },
        {
            entity: 'thing', id: String(THING_ID), field: 'createdAt',
            update: { createdAt: THING_DATE.toISOString() }
        },
        { entity: 'thing', id: String(THING_ID), field: 'modifiedAt', update: { modifiedAt: 999 } },
        { entity: 'thing', id: String(THING_ID), field: 'attachments', update: { attachments: [{ identifier: 'corrupt' }] } },
        { entity: 'thing', id: String(THING_ID), field: 'externalContent', update: { externalContent: [{ url: 'https://corrupt.test' }] } },
        { entity: 'thing', id: String(THING_ID), field: 'public', update: { public: false } },
        { entity: 'thing', id: String(THING_ID), field: 'shared', update: { shared: true } },
        { entity: 'thing', id: String(THING_ID), field: 'archived', update: { archived: false } },
        { entity: 'thing', id: String(THING_ID), field: 'sticky', update: { sticky: true } },
        { entity: 'tag', id: 'alpha', field: 'name', update: { name: 'corrupt-alpha' } },
        { entity: 'tag', id: 'alpha', field: 'usage', update: { usage: 99 } },
        { entity: 'tag', id: 'alpha', field: 'createdAt', update: { createdAt: 999 } },
        { entity: 'settings', id: 'frontend', field: 'value', update: { value: { title: 'corrupt' } } }
    ];

    mismatchCases.forEach(function (testCase) {
        it('reports the exact ' + testCase.entity + '.' + testCase.field + ' mismatch', function () {
            return restoreTargets().then(function () {
                if (testCase.mutate) return testCase.mutate(db);
                if (testCase.entity === 'thing') {
                    return db.collection('things').updateOne({ _id: THING_ID }, { $set: testCase.update });
                }
                if (testCase.entity === 'tag') {
                    return db.collection('tags').updateOne(
                        { ownerId: PREFIX, name: 'alpha' },
                        { $set: testCase.update }
                    );
                }
                return db.collection('settings').updateOne(
                    { ownerId: PREFIX },
                    { $set: testCase.update }
                );
            }).then(function () {
                return verificationResult(db);
            }).then(function (outcome) {
                expect(outcome.error).to.be.ok();
                expect(outcome.result).to.be(undefined);
                expect(outcome.error.message).to.contain([
                    'Mismatch:',
                    'user=' + PREFIX,
                    'entity=' + testCase.entity,
                    'id=' + testCase.id,
                    'field=' + testCase.field
                ].join('\n'));
            });
        });
    });

    it('merges distinct legacy alias records before comparing one canonical owner', function () {
        var aliasThing = {
            _id: ALIAS_THING_ID,
            content: 'Alias note',
            createdAt: 3000,
            modifiedAt: 3500,
            attachments: [],
            externalContent: [],
            public: false,
            shared: false,
            archived: false,
            sticky: false
        };
        var unifiedAliasThing = Object.assign({}, aliasThing, { ownerId: PREFIX });

        return restoreTargets().then(function () {
            return Promise.all([
                db.collection(ALIAS_PREFIX + '_things').deleteMany({}),
                db.collection('things').deleteOne({ _id: ALIAS_THING_ID })
            ]);
        }).then(function () {
            return Promise.all([
                db.collection(ALIAS_PREFIX + '_things').insertOne(aliasThing),
                db.collection('things').insertOne(unifiedAliasThing)
            ]);
        }).then(function () {
            return verificationResult(db, [aliasThing]);
        }).then(function (outcome) {
            if (outcome.error) throw outcome.error;
            expect(outcome.result.manifest.thingsCount).to.equal(3);
        }).finally(function () {
            return Promise.all([
                db.collection(ALIAS_PREFIX + '_things').drop().catch(function () {}),
                db.collection('things').deleteOne({ _id: ALIAS_THING_ID })
            ]);
        });
    });

    it('collapses an identical source identity across legacy aliases', function () {
        return db.collection(PREFIX + '_things').findOne({ _id: THING_ID }).then(async function (thing) {
            await db.collection(ALIAS_PREFIX + '_things').insertOne(thing);
            return thing;
        }).then(function (thing) {
            return verificationResult(db, [thing]);
        }).then(function (outcome) {
            if (outcome.error) throw outcome.error;
            expect(outcome.result.manifest.thingsCount).to.equal(2);
        }).finally(function () {
            return db.collection(ALIAS_PREFIX + '_things').drop().catch(function () {});
        });
    });

    it('rejects a conflicting source identity across legacy aliases', function () {
        return db.collection(PREFIX + '_things').findOne({ _id: THING_ID }).then(async function (thing) {
            thing.content = 'conflict';
            await db.collection(ALIAS_PREFIX + '_things').insertOne(thing);
            return thing;
        }).then(function (thing) {
            return verificationResult(db, [thing]);
        }).then(function (outcome) {
            expect(outcome.error).to.be.ok();
            expect(outcome.error.message).to.contain('Conflicting mapped legacy thing identity');
        }).finally(function () {
            return db.collection(ALIAS_PREFIX + '_things').drop().catch(function () {});
        });
    });

    it('does not hide an extra target tag named __proto__', function () {
        return db.collection('tags').insertOne({
            ownerId: PREFIX,
            name: '__proto__',
            usage: 1,
            createdAt: 1
        }).then(function () {
            return verificationResult(db);
        }).then(function (outcome) {
            expect(outcome.error).to.be.ok();
            expect(outcome.error.message).to.contain('entity=tag');
            expect(outcome.error.message).to.contain('id=__proto__');
            return db.collection('tags').deleteOne({ ownerId: PREFIX, name: '__proto__' });
        });
    });

    it('rejects duplicate target identities explicitly', function () {
        return db.collection('tags').dropIndex('ownerId_1_name_1').then(function () {
            return db.collection('tags').insertOne({
                ownerId: PREFIX,
                name: 'alpha',
                usage: 5,
                createdAt: 1100
            });
        }).then(function () {
            return verificationResult(db);
        }).then(function (outcome) {
            expect(outcome.error).to.be.ok();
            expect(outcome.error.message).to.contain('entity=tag');
            expect(outcome.error.message).to.contain('field=identity');
            return db.collection('tags').deleteMany({ ownerId: PREFIX });
        }).then(function () {
            return db.collection('tags').insertMany(baselineTags);
        }).then(function () {
            return db.collection('tags').createIndex({ ownerId: 1, name: 1 }, { unique: true });
        });
    });

    it('prints the canonical manifest and required success text', function () {
        var expectedSourceFile = path.join(os.tmpdir(), 'meemo-canonical-source-' + process.pid + '.json');
        return restoreTargets().then(function () {
            return sourceExpectations.expectedSource(
                sourceDocuments, null, db.databaseName
            );
        }).then(function (expectedSource) {
            fs.rmSync(expectedSourceFile, { force: true });
            fs.writeFileSync(expectedSourceFile, JSON.stringify(expectedSource), { mode: 0o600 });
            fs.chmodSync(expectedSourceFile, 0o400);
            return db.collection('system_migrations').updateOne(
                { _id: 'schema-v2' },
                { $set: { sourceEvidenceDigest: sourceExpectations.digest(expectedSource) } }
            );
        }).then(function () {
            var result = childProcess.spawnSync(process.execPath, [
                path.resolve(__dirname, '../../scripts/migrate-data-to-v2.js'),
                '--verify', '--mongo-url', config.databaseUrl,
                '--expect-database', db.databaseName,
                '--expected-source', expectedSourceFile
            ], { encoding: 'utf8', timeout: 10000 });

            expect(result.status).to.equal(0);
            expect(result.stdout).to.contain('Migration verification succeeded.');
            expect(result.stdout).to.contain('Canonical source and target manifests match.');
            expect(result.stdout).to.contain('"thingsCount": 2');
            expect(result.stdout).to.contain('"tagsCount": 2');
        }).finally(function () {
            fs.rmSync(expectedSourceFile, { force: true });
        });
    });
});
