/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    crypto = require('crypto'),
    fs = require('fs'),
    os = require('os'),
    path = require('path'),
    MongoClient = require('mongodb').MongoClient,
    ObjectId = require('mongodb').ObjectId,
    config = require('../config.js'),
    users = require('../users.js'),
    ownerMaps = require('../../scripts/owner-map.js'),
    userMigrator = require('../../scripts/migrate-users-to-mongo.js'),
    migrator = require('../../scripts/migrate-data-to-v2.js');

var OWNER_ID = '000000000000000000007101';
var ALPHA_THING_ID = new ObjectId('000000000000000000007102');
var BETA_THING_ID = new ObjectId('000000000000000000007103');

function callbackPromise(invoke) {
    return new Promise(function (resolve, reject) {
        invoke(function (error, result) {
            if (error) return reject(error);
            resolve(result);
        });
    });
}

function outcome(invoke) {
    return new Promise(function (resolve) {
        invoke(function (error, result) {
            resolve({ error: error, result: result });
        });
    });
}

function thing(id, content) {
    return {
        _id: id,
        content: content,
        createdAt: 100,
        modifiedAt: 200,
        attachments: [],
        externalContent: [],
        public: false,
        shared: false,
        archived: false,
        sticky: false
    };
}

describe('Migration owner maps', function () {
    this.timeout(20000);

    var client;
    var db;
    var originalRepository;
    var ownerMapFile;

    before(async function () {
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        originalRepository = users.getRepository();
        users.setRepository({
            get: function (identifier) {
                if (identifier === 'canonical-owner') {
                    return Promise.resolve({ id: 'canonical-owner', username: 'canonical-owner' });
                }
                return Promise.resolve(null);
            },
            getByUsername: function (username) {
                if (username === 'canonical-owner') {
                    return Promise.resolve({ id: username, username: username });
                }
                return Promise.resolve(null);
            }
        });
        ownerMapFile = path.join(os.tmpdir(), 'meemo-owner-map-' + process.pid + '.json');
    });

    beforeEach(function () {
        return callbackPromise(function (done) { config._clearDatabase(done); }).then(function () {
            return db.collection('users').insertOne({
                _id: new ObjectId(OWNER_ID),
                username: 'canonical-owner',
                usernameNorm: 'canonical-owner'
            });
        });
    });

    after(async function () {
        users.setRepository(originalRepository);
        fs.rmSync(ownerMapFile, { force: true });
        await client.close();
    });

    function writeMap(raw) {
        fs.writeFileSync(ownerMapFile, raw);
        return ownerMaps.load(ownerMapFile);
    }

    function seedDistinct(settingsValues) {
        settingsValues = settingsValues || [{ title: 'same' }, { title: 'same' }];
        return Promise.all([
            db.collection('alpha_things').insertOne(thing(ALPHA_THING_ID, 'alpha')),
            db.collection('beta_things').insertOne(thing(BETA_THING_ID, 'beta')),
            db.collection('alpha_tags').insertOne({ name: 'alpha', usage: 1, createdAt: 100 }),
            db.collection('beta_tags').insertOne({ name: 'beta', usage: 2, createdAt: 200 }),
            db.collection('alpha_settings').insertOne({ type: 'frontend', value: settingsValues[0] }),
            db.collection('beta_settings').insertOne({ type: 'frontend', value: settingsValues[1] })
        ]);
    }

    it('merges two prefixes into one owner and collapses identical settings', async function () {
        var raw = '{\n  "alpha": "canonical-owner",\n  "beta": "canonical-owner"\n}\n';
        var ownerMap = writeMap(raw);
        await seedDistinct();

        var report = await callbackPromise(function (done) {
            migrator.dryRun({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(report.ownerMap).to.eql({
            count: 2,
            digest: crypto.createHash('sha256').update(Buffer.from(raw)).digest('hex')
        });
        expect(report.ownerMap).to.only.have.keys('count', 'digest');
        expect(JSON.stringify(report.ownerMap)).not.to.contain('canonical-owner');

        await callbackPromise(function (done) {
            migrator.apply({ db: db, ownerMapPath: ownerMapFile }, done);
        });

        expect(await db.collection('things').countDocuments({ ownerId: OWNER_ID })).to.be(2);
        expect(await db.collection('things').countDocuments({ ownerId: 'canonical-owner' })).to.be(0);
        expect(await db.collection('tags').countDocuments({ ownerId: OWNER_ID })).to.be(2);
        expect(await db.collection('settings').countDocuments({ ownerId: OWNER_ID })).to.be(1);
        var state = await db.collection('system_migrations').findOne({ _id: 'schema-v2' });
        expect(state.ownerMapDigest).to.be(ownerMap.digest);

        var verified = await callbackPromise(function (done) {
            migrator.verify({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(verified.success).to.be(true);
    });

    it('collapses identical mapped thing identities and rejects conflicts during dry-run', async function () {
        writeMap('{"alpha":"canonical-owner","beta":"canonical-owner"}');
        await Promise.all([
            db.collection('alpha_things').insertOne(thing(ALPHA_THING_ID, 'same')),
            db.collection('beta_things').insertOne(thing(ALPHA_THING_ID, 'same'))
        ]);

        var report = await callbackPromise(function (done) {
            migrator.dryRun({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(report.totalThingsToMigrate).to.be(1);

        await callbackPromise(function (done) {
            migrator.apply({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(await db.collection('things').countDocuments({ ownerId: OWNER_ID })).to.be(1);
        var verified = await callbackPromise(function (done) {
            migrator.verify({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(verified.success).to.be(true);

        await db.collection('things').deleteMany({});
        await db.collection('system_migrations').deleteMany({});
        await db.collection('beta_things').updateOne(
            { _id: ALPHA_THING_ID }, { $set: { content: 'different' } }
        );

        var result = await outcome(function (done) {
            migrator.dryRun({ db: db, ownerMapPath: ownerMapFile }, done);
        });

        expect(result.error).to.be.an(Error);
        expect(result.error.message).to.contain('Conflicting mapped legacy thing identity');
        expect(await db.collection('things').countDocuments({})).to.be(0);
    });

    it('uses a reviewed users manifest for dry-run before users are applied', async function () {
        var usersFile = path.join(os.tmpdir(), 'meemo-owner-users-' + process.pid + '.json');
        var manifestFile = path.join(os.tmpdir(), 'meemo-owner-users-manifest-' + process.pid + '.json');
        writeMap('{"alpha":"canonical-owner"}');
        fs.writeFileSync(usersFile, JSON.stringify({
            owner: { username: 'canonical-owner', passwordHash: 'hash' }
        }));
        await db.collection('users').deleteMany({});
        await db.collection('alpha_things').insertOne(thing(ALPHA_THING_ID, 'alpha'));

        try {
            await callbackPromise(function (done) {
                userMigrator.dryRun({
                    usersFile: usersFile,
                    manifestFile: manifestFile,
                    mongoUrl: config.databaseUrl
                }, done);
            });
            var report = await callbackPromise(function (done) {
                migrator.dryRun({
                    db: db,
                    mongoUrl: config.databaseUrl,
                    ownerMapPath: ownerMapFile,
                    usersFile: usersFile,
                    usersManifestFile: manifestFile
                }, done);
            });
            expect(report.totalLegacyUsers).to.be(1);
            expect(report.totalThingsToMigrate).to.be(1);
            expect(await db.collection('users').countDocuments({})).to.be(0);

            await db.collection('users').insertOne({
                _id: new ObjectId('000000000000000000007199'),
                username: 'canonical-owner',
                usernameNorm: 'canonical-owner'
            });
            var conflict = await outcome(function (done) {
                migrator.dryRun({
                    db: db,
                    mongoUrl: config.databaseUrl,
                    ownerMapPath: ownerMapFile,
                    usersFile: usersFile,
                    usersManifestFile: manifestFile
                }, done);
            });
            expect(conflict.error).to.be.ok();
            expect(conflict.error.message).to.contain('does not match reviewed users manifest');
        } finally {
            fs.rmSync(usersFile, { force: true });
            fs.rmSync(manifestFile, { force: true });
        }
    });

    it('rejects incomplete or write-mode users manifest arguments', function () {
        expect(function () {
            migrator.parseArgs(['--dry-run', '--users-file', '/tmp/users.json']);
        }).to.throwError(/required together/);
        expect(function () {
            migrator.parseArgs([
                '--apply', '--users-file', '/tmp/users.json',
                '--users-manifest', '/tmp/users-manifest.json'
            ]);
        }).to.throwError(/valid only with --dry-run/);
    });

    it('rejects conflicting mapped settings before unified writes', async function () {
        var ownerMap = writeMap('{"alpha":"canonical-owner","beta":"canonical-owner"}');
        await seedDistinct([{ title: 'alpha' }, { title: 'beta' }]);

        var result = await outcome(function (done) {
            migrator.apply({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(result.error).to.be.ok();
        expect(result.error.message).to.contain('settings values conflict');
        expect(result.error.message).not.to.contain('canonical-owner');
        expect(await db.collection('things').countDocuments({})).to.be(0);
        expect(await db.collection('tags').countDocuments({})).to.be(0);
        expect(await db.collection('settings').countDocuments({})).to.be(0);
    });

    it('rejects unknown map prefixes without revealing their names or values', async function () {
        var ownerMap = writeMap('{"alpha":"canonical-owner","ghost":"secret-owner"}');
        await db.collection('alpha_things').insertOne(thing(ALPHA_THING_ID, 'alpha'));

        var result = await outcome(function (done) {
            migrator.dryRun({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        expect(result.error).to.be.ok();
        expect(result.error.message).to.contain('unknown legacy prefix');
        expect(result.error.message).not.to.contain('ghost');
        expect(result.error.message).not.to.contain('secret-owner');
    });

    it('rejects replay and verification when raw owner-map bytes change', async function () {
        var first = writeMap('{"alpha":"canonical-owner"}');
        await db.collection('alpha_things').insertOne(thing(ALPHA_THING_ID, 'alpha'));
        await callbackPromise(function (done) {
            migrator.apply({ db: db, ownerMapPath: ownerMapFile }, done);
        });

        var changed = writeMap('{ "alpha": "canonical-owner" }\n');
        var replay = await outcome(function (done) {
            migrator.apply({ db: db, ownerMapPath: ownerMapFile }, done);
        });
        var verification = await outcome(function (done) {
            migrator.verify({ db: db, ownerMapPath: ownerMapFile }, done);
        });

        expect(replay.error).to.be.ok();
        expect(replay.error.message).to.contain('Owner map digest does not match');
        expect(verification.error).to.be.ok();
        expect(verification.error.message).to.contain('Owner map digest does not match');
    });
});
