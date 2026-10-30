'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const http = require('node:http');
const tar = require('tar-stream');
const restore = require('../../scripts/verify-restore.js');
const { assertOwned } = require('../../scripts/verification-docker.js');

function hash(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

describe('Isolated restore verification guards', function () {
    this.timeout(20000);
    it('detects missing, writable, linked, corrupted and unsafe backup artifacts', async function () {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-restore-guard-'));
        try {
            restore.writeArtifact(directory, 'archive', 'synthetic');
            const hashes = { archive: hash('synthetic') };
            await restore.verifyArtifacts(directory, hashes);
            assert.throws(() => restore.writeArtifact(directory, 'archive', 'overwrite'), /EEXIST/);
            await assert.rejects(() => restore.verifyArtifacts(directory, {}), /must not be empty/);
            await assert.rejects(() => restore.verifyArtifacts(directory, { '../archive': hashes.archive }), /single file names/);
            fs.unlinkSync(path.join(directory, 'archive'));
            restore.writeArtifact(directory, 'archive', 'corrupted');
            await assert.rejects(() => restore.verifyArtifacts(directory, hashes), /checksum mismatch/);
            fs.unlinkSync(path.join(directory, 'archive'));
            await assert.rejects(() => restore.verifyArtifacts(directory, hashes), /ENOENT/);
            fs.writeFileSync(path.join(directory, 'archive'), 'synthetic', { mode: 0o600 });
            await assert.rejects(() => restore.verifyArtifacts(directory, hashes), /read-only/);
            fs.symlinkSync('archive', path.join(directory, 'linked'));
            await assert.rejects(() => restore.verifyArtifacts(directory, { linked: hashes.archive }), /regular file/);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('compares full documents and indexes while preserving compound index key order', async function () {
        function database(document, key) {
            return {
                listCollections: () => ({ toArray: async () => [{ name: 'things' }] }),
                collection: () => ({
                    find: () => ({ sort: () => ({ toArray: async () => [document] }) }),
                    indexes: async () => [{ name: 'owner_feed', key }]
                })
            };
        }
        const expected = await restore.databaseSnapshot(database({ ownerId: 'alice', content: 'synthetic' }, { ownerId: 1, modifiedAt: -1 }));
        const reordered = await restore.databaseSnapshot(database({ content: 'synthetic', ownerId: 'alice' }, { ownerId: 1, modifiedAt: -1 }));
        restore.verifySnapshot(expected, reordered);
        const changed = await restore.databaseSnapshot(database({ ownerId: 'bob', content: 'synthetic' }, { ownerId: 1, modifiedAt: -1 }));
        assert.throws(() => restore.verifySnapshot(expected, changed), /documents or indexes differ/);
        const wrongIndex = await restore.databaseSnapshot(database({ ownerId: 'alice', content: 'synthetic' }, { modifiedAt: -1, ownerId: 1 }));
        assert.throws(() => restore.verifySnapshot(expected, wrongIndex), /documents or indexes differ/);
        assert.throws(() => restore.verifySnapshot({}, {}), /Empty snapshots/);
    });

    it('rejects an archive containing another image independently of the daemon cache', async function () {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-image-guard-'));
        const cachedConfig = Buffer.from('{"cached":"retained-image"}');
        const cachedImageId = `sha256:${hash(cachedConfig)}`;
        async function archive(config, name) {
            const pack = tar.pack();
            const configName = `${hash(config)}.json`;
            pack.entry({ name: configName }, config);
            pack.entry({ name: 'manifest.json' }, JSON.stringify([{ Config: configName, Layers: [] }]));
            pack.finalize();
            const chunks = [];
            for await (const chunk of pack) chunks.push(chunk);
            const filename = path.join(directory, name);
            fs.writeFileSync(filename, Buffer.concat(chunks), { mode: 0o400 });
            return filename;
        }
        try {
            await restore.verifyImageArchive(await archive(cachedConfig, 'right.tar'), cachedImageId);
            const wrong = await archive(Buffer.from('{"other":"image"}'), 'wrong.tar');
            await assert.rejects(() => restore.verifyImageArchive(wrong, cachedImageId), /does not match the retained image/);
        } finally {
            fs.rmSync(directory, { recursive: true, force: true });
        }
    });

    it('bounds both response-header and response-body stalls and reaches finally', async function () {
        for (const sendHeaders of [false, true]) {
            const server = http.createServer((req, res) => {
                if (sendHeaders) { res.writeHead(200); res.flushHeaders(); }
            });
            await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
            let cleanedUp = false;
            const started = Date.now();
            try {
                await assert.rejects(() => restore.request(`http://127.0.0.1:${server.address().port}`, { timeout: { response: 100, deadline: 200 } }).get('/stall').expect(200), /timeout/i);
                assert(Date.now() - started < 2000);
            } finally {
                server.closeAllConnections();
                await new Promise(resolve => server.close(resolve));
                cleanedUp = true;
            }
            assert(cleanedUp);
        }
    });

    it('rejects foreign resource ownership and external CLI targets without echoing credentials', function () {
        assertOwned('this-run', 'this-run');
        assert.throws(() => assertOwned('other-run', 'this-run'), /another run/);
        const secret = 'do-not-print-test-credential';
        for (const args of [
            ['scripts/verify-restore.js', '--mongo-url', `mongodb://${secret}@invalid/production`],
            ['scripts/benchmark-search.js', '--relevance', '--mongo-url', `mongodb://${secret}@invalid/production`],
            ['scripts/benchmark-search.js', '--relevance=invalid']
        ]) {
            const result = spawnSync(process.execPath, args, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 10000 });
            assert.equal(result.status, 1);
            assert.match(result.stderr, /no arguments|no external targets/);
            assert(!result.stderr.includes(secret));
        }
    });
});
