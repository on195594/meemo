#!/usr/bin/env node

'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MongoClient, BSON } = require('mongodb');
const supertest = require('supertest');
const { pipeline } = require('node:stream/promises');
const tar = require('tar-stream');
const isolation = require('./verification-docker.js');
const { docker, label, port, startMongo, waitFor, removeOwned } = isolation;

const DATABASE = 'meemo_restore';

function request(base, options) {
    const agent = supertest(base);
    const timeouts = (options && options.timeout) || { response: 5000, deadline: 10000 };
    for (const method of ['get', 'post', 'put', 'delete']) {
        const original = agent[method];
        agent[method] = route => {
            isolation.signal()?.throwIfAborted();
            return original(route).timeout(timeouts);
        };
    }
    return agent;
}

function digest(value) {
    function sorted(item) {
        if (Array.isArray(item)) return item.map(sorted);
        if (item && typeof item === 'object') return Object.fromEntries(Object.keys(item).sort().map(key => [key, sorted(item[key])]));
        return item;
    }
    return crypto.createHash('sha256').update(JSON.stringify(sorted(BSON.EJSON.serialize(value, { relaxed: false })))).digest('hex');
}

async function fileDigest(filename) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) {
        isolation.signal()?.throwIfAborted();
        hash.update(chunk);
    }
    return hash.digest('hex');
}

function writeArtifact(directory, name, content) {
    const fd = fs.openSync(path.join(directory, name), 'wx', 0o400);
    try {
        fs.writeFileSync(fd, content);
    } finally {
        fs.closeSync(fd);
    }
}

async function verifyArtifacts(directory, hashes) {
    assert(Object.keys(hashes).length > 0, 'Backup manifest must not be empty');
    for (const [name, expected] of Object.entries(hashes)) {
        assert.equal(path.basename(name), name, 'Backup paths must be single file names');
        const filename = path.join(directory, name);
        const stat = fs.lstatSync(filename);
        assert(stat.isFile() && !stat.isSymbolicLink(), 'Backup artifact must be a regular file');
        assert.equal(stat.mode & 0o222, 0, 'Backup artifacts must remain read-only');
        assert.equal(await fileDigest(filename), expected, `Backup checksum mismatch: ${name}`);
    }
}

async function databaseSnapshot(db) {
    const snapshot = {};
    for (const { name } of (await db.listCollections().toArray()).sort((a, b) => a.name.localeCompare(b.name))) {
        isolation.signal()?.throwIfAborted();
        const collection = db.collection(name);
        const documents = await collection.find({}).sort({ _id: 1 }).toArray();
        const indexes = (await collection.indexes()).sort((a, b) => a.name.localeCompare(b.name));
        snapshot[name] = {
            count: documents.length,
            documents: digest(documents),
            // Compound index key order is significant even though other object field order is not.
            indexes: digest(indexes.map(index => ({ ...index, key: Object.entries(index.key) })))
        };
    }
    return snapshot;
}

function verifySnapshot(expected, actual) {
    assert(Object.keys(expected).length > 0, 'Empty snapshots cannot prove a restore');
    assert.deepEqual(actual, expected, 'Restored documents or indexes differ from the backup');
}

async function archive(directory, name, args) {
    const fd = fs.openSync(path.join(directory, name), 'wx', 0o400);
    try {
        await docker(args, { stdio: ['ignore', fd, 'pipe'] });
    } finally {
        fs.closeSync(fd);
    }
}

async function inputArchive(filename, args) {
    const fd = fs.openSync(filename, 'r');
    try {
        await docker(args, { stdio: [fd, 'pipe', 'pipe'] });
    } finally {
        fs.closeSync(fd);
    }
}

async function verifyImageArchive(filename, imageId) {
    assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
    const extract = tar.extract();
    const digests = new Map();
    let manifest;
    extract.on('entry', (header, stream, next) => {
        (async () => {
            const hash = crypto.createHash('sha256');
            const chunks = [];
            let bytes = 0;
            for await (const chunk of stream) {
                hash.update(chunk);
                if (header.name === 'manifest.json') {
                    bytes += chunk.length;
                    assert(bytes <= 1024 * 1024, 'Image manifest is too large');
                    chunks.push(chunk);
                }
            }
            if (header.type === 'file') {
                assert(!digests.has(header.name), 'Duplicate image archive entry');
                digests.set(header.name, hash.digest('hex'));
                if (header.name === 'manifest.json') manifest = JSON.parse(Buffer.concat(chunks));
            }
            next();
        })().catch(error => extract.destroy(error));
    });
    await pipeline(fs.createReadStream(filename), extract, { signal: isolation.signal() || undefined });
    assert(Array.isArray(manifest) && manifest.length === 1, 'Archive must contain exactly the retained image');
    assert.equal(digests.get(manifest[0].Config), imageId.slice(7), 'Archive image config does not match the retained image');
    assert(Array.isArray(manifest[0].Layers) && manifest[0].Layers.every(name => digests.has(name)), 'Archive image layers are missing');
}

function cookies(response) {
    return response.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
}

async function login(base, username) {
    return request(base).post('/api/login').send({ username, password: 'synthetic-restore-password' }).expect(200);
}

async function authenticated(base, cookie, route) {
    return request(base).get(route).set('Cookie', cookie).expect(200);
}

async function bytes(base, cookie, route) {
    const response = await fetch(base + route, { headers: cookie ? { Cookie: cookie } : {}, signal: AbortSignal.any([AbortSignal.timeout(10000), ...(isolation.signal() ? [isolation.signal()] : [])]) });
    assert.equal(response.status, 200);
    return Buffer.from(await response.arrayBuffer());
}

async function verifyExport(base, cookie, fixture) {
    const entries = new Map();
    const extract = tar.extract();
    const buffer = await bytes(base, cookie, '/api/export');
    await new Promise((resolve, reject) => {
        extract.on('entry', (header, stream, next) => {
            (async () => {
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                if (header.type === 'file') {
                    assert(!entries.has(header.name), 'Duplicate export entry');
                    entries.set(header.name, Buffer.concat(chunks));
                }
                next();
            })().catch(error => { extract.destroy(error); reject(error); });
        });
        extract.on('error', reject);
        extract.on('finish', resolve);
        extract.end(buffer);
    });
    const exported = JSON.parse(entries.get('things.json').toString());
    const notes = [fixture.privateNote, fixture.publicNote, fixture.archivedNote];
    assert.equal(exported.things.length, notes.length, 'Empty or incomplete user export');
    for (const note of notes) {
        const item = exported.things.find(thing => thing.content === note.content);
        assert(item, 'Expected content missing from export');
        for (const key of ['revision', 'attachments', 'createdAt', 'modifiedAt']) assert.deepEqual(item[key], note[key]);
    }
    assert.deepEqual(entries.get(`attachments/${fixture.attachment.identifier}`), fixture.attachmentBytes);
    assert.equal(entries.size, 2);
}

async function seed(base) {
    for (const username of ['restore-alice', 'restore-bob']) {
        await request(base).post('/api/register').send({ username, password: 'synthetic-restore-password', email: `${username}@example.invalid`, displayName: username }).expect(201);
    }
    const aliceCookie = cookies(await login(base, 'restore-alice'));
    const bobCookie = cookies(await login(base, 'restore-bob'));
    const alice = (await authenticated(base, aliceCookie, '/api/profile')).body.user;
    const bob = (await authenticated(base, bobCookie, '/api/profile')).body.user;
    const attachmentBytes = Buffer.from([0, 255, 1, 2, 10, 13, 65, 66]);
    const attachment = (await request(base).post('/api/files').set('Cookie', aliceCookie).attach('file', attachmentBytes, 'restore.bin').expect(201)).body;
    async function note(cookie, content, attachments = []) {
        return (await request(base).post('/api/things').set('Cookie', cookie).send({ content, attachments }).expect(201)).body.thing;
    }
    async function update(thing, flags) {
        return (await request(base).put(`/api/things/${thing._id}`).set('Cookie', aliceCookie).send({ content: thing.content, attachments: thing.attachments, expectedRevision: thing.revision, ...flags }).expect(201)).body.thing;
    }
    const privateNote = await note(aliceCookie, 'Synthetic private note #restore', [attachment]);
    const publicNote = await update(await note(aliceCookie, 'Synthetic shared note #restore', [attachment]), { public: true, shared: true });
    const archivedNote = await update(await note(aliceCookie, 'Synthetic archived note #restore'), { archived: true });
    const trash = await update(await note(aliceCookie, 'Synthetic trashed share #restore'), { public: true, shared: true });
    await request(base).delete(`/api/things/${trash._id}`).set('Cookie', aliceCookie).send({ expectedRevision: trash.revision }).expect(200);
    const trashedNote = (await authenticated(base, aliceCookie, '/api/things?deleted=true')).body.things.find(item => item._id === trash._id);
    assert(trashedNote && trashedNote.deletedAt);
    const bobNote = await note(bobCookie, 'Synthetic isolated owner note #restore');
    const settings = { theme: 'dark', restoreMarker: 'synthetic' };
    await request(base).post('/api/settings').set('Cookie', aliceCookie).send({ settings }).expect(202);
    return { aliceCookie, bobCookie, alice, bob, privateNote, publicNote, archivedNote, trashedNote, bobNote, settings, attachmentBytes, attachment };
}

async function verifyReadback(base, fixture) {
    const aliceCookie = cookies(await login(base, 'restore-alice'));
    const bobCookie = cookies(await login(base, 'restore-bob'));
    assert.equal((await authenticated(base, aliceCookie, '/api/profile')).body.user.id, fixture.alice.id);
    assert.equal((await authenticated(base, bobCookie, '/api/profile')).body.user.id, fixture.bob.id);
    for (const thing of [fixture.privateNote, fixture.publicNote, fixture.archivedNote]) {
        const restored = (await authenticated(base, aliceCookie, `/api/things/${thing._id}`)).body.thing;
        for (const key of ['ownerId', 'content', 'revision', 'attachments', 'tags', 'public', 'shared', 'archived']) {
            assert.deepEqual(restored[key], thing[key], `Readback differs for ${key}`);
        }
    }
    await request(base).get(`/api/things/${fixture.bobNote._id}`).set('Cookie', aliceCookie).expect(404);
    await request(base).get(`/api/things/${fixture.privateNote._id}`).set('Cookie', bobCookie).expect(404);
    const active = (await authenticated(base, aliceCookie, '/api/things')).body.things.map(item => item._id).sort();
    assert.deepEqual(active, [fixture.privateNote._id, fixture.publicNote._id].sort());
    const archived = (await authenticated(base, aliceCookie, '/api/things?archived=true')).body.things;
    assert.deepEqual(archived.map(item => item._id), [fixture.archivedNote._id]);
    const trash = (await authenticated(base, aliceCookie, '/api/things?deleted=true')).body.things;
    assert.equal(trash.length, 1);
    assert.equal(trash[0]._id, fixture.trashedNote._id);
    assert.equal(trash[0].revision, fixture.trashedNote.revision);
    assert(trash[0].deletedAt);
    assert.deepEqual((await authenticated(base, aliceCookie, '/api/settings')).body.settings, fixture.settings);
    const tags = (await authenticated(base, aliceCookie, '/api/tags')).body.tags;
    assert(tags.some(tag => tag.name === 'restore'));
    await request(base).get(`/api/public/${fixture.alice.id}/things/${fixture.publicNote._id}`).expect(200);
    await request(base).get(`/api/public/shared/things/${fixture.publicNote._id}`).expect(200);
    await request(base).get(`/api/public/${fixture.alice.id}/things/${fixture.trashedNote._id}`).expect(404);
    await request(base).get(`/api/public/shared/things/${fixture.trashedNote._id}`).expect(404);
    const file = `/api/files/${fixture.alice.id}/${fixture.privateNote._id}/${fixture.attachment.identifier}`;
    assert.deepEqual(await bytes(base, aliceCookie, file), fixture.attachmentBytes);
    await verifyExport(base, aliceCookie, fixture);
    return aliceCookie;
}

async function verify() {
    assert.equal(process.argv.length, 2, 'Restore verification accepts no arguments or external database/volume targets');
    const runId = `meemo-restore-${crypto.randomUUID()}`;
    console.error(`Verification run: ${runId}`);
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-restore-'));
    const backup = path.join(work, 'backup');
    const network = `${runId}-net`;
    const image = `meemo-restore:${runId}`;
    const sourceMongo = `${runId}-source-mongo`;
    const targetMongo = `${runId}-target-mongo`;
    const sourceApp = `${runId}-source-app`;
    const targetApp = `${runId}-target-app`;
    const sourceVolume = `${runId}-source-data`;
    const targetVolume = `${runId}-target-data`;
    const clients = [];
    const started = Date.now();
    const secret = crypto.randomBytes(32).toString('hex');
    try {
        assert.equal(fs.statSync(work).mode & 0o077, 0, 'Restore workspace must be private');
        fs.mkdirSync(backup, { mode: 0o700 });
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: isolation.root, encoding: 'utf8', timeout: 5000 }).trim();
        const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: isolation.root, encoding: 'utf8', timeout: 5000 }).trim();
        await docker(['info']);
        await docker(['build', '--label', `${label}=${runId}`, '--build-arg', `COMMIT=${commit}`, '--build-arg', 'VERSION=synthetic-restore-check', '-t', image, '.'], { timeout: 300000 });
        const imageId = await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
        await docker(['network', 'create', '--label', `${label}=${runId}`, network]);
        for (const volume of [sourceVolume, targetVolume]) await docker(['volume', 'create', '--label', `${label}=${runId}`, volume]);
        async function connect(container) {
            const uri = await startMongo(container, runId, network);
            const client = await MongoClient.connect(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 });
            clients.push(client);
            return client;
        }
        const source = await connect(sourceMongo);
        const target = await connect(targetMongo);
        const mongoImageId = await docker(['inspect', sourceMongo, '--format', '{{.Image}}']);
        assert.equal(await docker(['inspect', targetMongo, '--format', '{{.Image}}']), mongoImageId);
        async function startApp(name, mongo, volume) {
            await docker(['run', '-d', '--name', name, '--label', `${label}=${runId}`, '--network', network, '-p', '127.0.0.1::3000', '--mount', `type=volume,src=${volume},dst=/app/data`, '-e', `MONGODB_URL=mongodb://${mongo}:27017/${DATABASE}`, '-e', `SESSION_SECRET=${secret}`, '-e', 'REGISTRATION_MODE=open', '-e', 'AUTH_USER_SOURCE=mongo', '-e', 'ENABLE_WORKERS=false', '-e', 'URL_ENRICHMENT_ENABLED=false', imageId]);
            const base = `http://127.0.0.1:${await port(name, 3000)}`;
            await waitFor(async () => request(base).get('/api/health/ready').timeout(5000).expect(200), name);
            return base;
        }
        const sourceBase = await startApp(sourceApp, sourceMongo, sourceVolume);
        const fixture = await seed(sourceBase);
        await source.db('travel_cards').collection('sentinel').insertOne({ _id: runId, untouched: 'source' });
        await target.db('travel_cards').collection('sentinel').insertOne({ _id: runId, untouched: 'target' });
        const sentinel = await databaseSnapshot(target.db('travel_cards'));
        await docker(['stop', sourceApp]);
        await source.db(DATABASE).collection('system_maintenance').insertOne({ _id: 'thing-writes', frozen: true });
        const expected = await databaseSnapshot(source.db(DATABASE));
        assert(expected.sessions.count > 0, 'Fixture must contain pre-restore sessions');
        const toolVersions = { mongo: (await source.db().admin().serverInfo()).version, dump: await docker(['exec', sourceMongo, 'mongodump', '--version']), restore: await docker(['exec', targetMongo, 'mongorestore', '--version']) };
        const snapshotStarted = Date.now();
        await archive(backup, 'mongodb.archive', ['exec', sourceMongo, 'mongodump', '--db', DATABASE, '--archive']);
        await archive(backup, 'meemo-data.tgz', ['run', '--rm', '--name', `${runId}-backup-tar`, '--label', `${label}=${runId}`, '--network', 'none', '--volumes-from', `${sourceApp}:ro`, '--entrypoint', 'tar', imageId, '-C', '/app/data', '-czf', '-', '.']);
        await archive(backup, 'image.tar', ['image', 'save', imageId]);
        const hashes = {};
        for (const name of fs.readdirSync(backup)) hashes[name] = await fileDigest(path.join(backup, name));
        const manifest = { schemaVersion: 1, synthetic: true, runId, sourceCommit: commit, workingTreeDirty: dirty, imageId, mongoImageId, database: DATABASE, startedAt: new Date(started).toISOString(), tools: toolVersions, hashes: { ...hashes }, snapshot: expected };
        writeArtifact(backup, 'manifest.json', JSON.stringify(manifest, null, 2));
        hashes['manifest.json'] = await fileDigest(path.join(backup, 'manifest.json'));
        await verifyArtifacts(backup, hashes);
        const backupMs = Date.now() - snapshotStarted;
        const restoreStarted = Date.now();
        await verifyImageArchive(path.join(backup, 'image.tar'), imageId);
        await inputArchive(path.join(backup, 'image.tar'), ['image', 'load']);
        assert.equal(await docker(['image', 'inspect', imageId, '--format', '{{.Id}}']), imageId);
        await inputArchive(path.join(backup, 'mongodb.archive'), ['exec', '-i', targetMongo, 'mongorestore', '--archive', '--nsInclude', `${DATABASE}.*`]);
        await inputArchive(path.join(backup, 'meemo-data.tgz'), ['run', '--rm', '-i', '--name', `${runId}-restore-tar`, '--label', `${label}=${runId}`, '--network', 'none', '--mount', `type=volume,src=${targetVolume},dst=/app/data`, '--entrypoint', 'tar', imageId, '-C', '/app/data', '-xzf', '-']);
        const restoredDb = target.db(DATABASE);
        verifySnapshot(expected, await databaseSnapshot(restoredDb));
        verifySnapshot(sentinel, await databaseSnapshot(target.db('travel_cards')));
        // Restore policy: revoke old sessions before serving; keep the write freeze until readback passes.
        await restoredDb.collection('sessions').deleteMany({});
        let targetBase = await startApp(targetApp, targetMongo, targetVolume);
        assert.equal(await docker(['inspect', targetApp, '--format', '{{.Image}}']), imageId);
        for (const cookie of [fixture.aliceCookie, fixture.bobCookie]) await request(targetBase).get('/api/profile').set('Cookie', cookie).expect(401);
        const aliceCookie = await verifyReadback(targetBase, fixture);
        await request(targetBase).post('/api/things').set('Cookie', aliceCookie).send({ content: 'must be blocked by restored freeze' }).expect(500);
        assert.equal(await restoredDb.collection('things').countDocuments(), expected.things.count);
        const released = await restoredDb.collection('system_maintenance').updateOne({ _id: 'thing-writes', frozen: true }, { $set: { frozen: false } });
        assert.equal(released.matchedCount, 1);
        const updated = await request(targetBase).put(`/api/things/${fixture.privateNote._id}`).set('Cookie', aliceCookie).send({ content: 'Verified post-restore write #restore', attachments: fixture.privateNote.attachments, expectedRevision: fixture.privateNote.revision }).expect(201);
        await request(targetBase).put(`/api/things/${fixture.privateNote._id}`).set('Cookie', aliceCookie).send({ content: 'stale write must not win', expectedRevision: fixture.privateNote.revision }).expect(409);
        await request(targetBase).post(`/api/things/${fixture.trashedNote._id}/restore`).set('Cookie', aliceCookie).send({ expectedRevision: fixture.trashedNote.revision }).expect(200);
        await request(targetBase).get(`/api/public/shared/things/${fixture.trashedNote._id}`).expect(403);
        await docker(['restart', targetApp]);
        targetBase = `http://127.0.0.1:${await port(targetApp, 3000)}`;
        await waitFor(async () => request(targetBase).get('/api/health/ready').timeout(5000).expect(200), 'restored app restart');
        const persisted = (await authenticated(targetBase, aliceCookie, `/api/things/${fixture.privateNote._id}`)).body.thing;
        assert.equal(persisted.revision, updated.body.thing.revision);
        assert.equal(persisted.content, updated.body.thing.content);
        const file = `/api/files/${fixture.alice.id}/${fixture.privateNote._id}/${fixture.attachment.identifier}`;
        assert.deepEqual(await bytes(targetBase, aliceCookie, file), fixture.attachmentBytes);
        verifySnapshot(sentinel, await databaseSnapshot(target.db('travel_cards')));
        await verifyArtifacts(backup, hashes);
        return { status: 'PASS', scope: 'synthetic isolated restore; not production readiness', ...manifest, manifestSha256: hashes['manifest.json'], backupMs, restoreMs: Date.now() - restoreStarted, totalMs: Date.now() - started, checks: ['documents', 'indexes', 'owner isolation', 'login', 'settings', 'tags', 'active/archive/trash', 'share revocation', 'attachment bytes', 'export contents', 'session revocation', 'write freeze', 'CAS', 'restart persistence', 'other-database sentinel', 'read-only backup hashes', 'image archive contents', 'retained image identity'] };
    } finally {
        const errors = [];
        for (const client of clients) {
            try { await client.close(); } catch (error) { errors.push(error); }
        }
        const resources = [
            ...[targetApp, sourceApp, targetMongo, sourceMongo, `${runId}-backup-tar`, `${runId}-restore-tar`].map(name => ['container', name]),
            ...[targetVolume, sourceVolume].map(name => ['volume', name]),
            ['network', network], ['image', image]
        ];
        for (const [type, name] of resources) {
            try { await removeOwned(type, name, runId); } catch (error) { errors.push(error); }
        }
        try { fs.rmSync(work, { recursive: true, force: true }); } catch (error) { errors.push(error); }
        if (errors.length) throw new Error(`Restore cleanup failed: ${errors.map(error => error.message).join('; ')}`);
    }
}

async function main() {
    return isolation.withSignals(verify);
}

if (require.main === module) {
    main().then(report => console.log(JSON.stringify({ ...report, cleanedUp: true }, null, 2))).catch(error => {
        console.error(`Restore verification FAIL: ${error.message}`);
        process.exitCode ||= 1;
    });
}

module.exports = { writeArtifact, verifyArtifacts, databaseSnapshot, verifySnapshot, verifyImageArchive, request };
