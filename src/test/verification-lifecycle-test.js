'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { docker, label, startMongo, removeOwned, root } = require('../../scripts/verification-docker.js');

async function anonymousVolumes(container) {
    const mounts = JSON.parse(await docker(['inspect', container, '--format', '{{json .Mounts}}']));
    const names = mounts.filter(mount => mount.Type === 'volume').map(mount => mount.Name);
    assert(names.length >= 2, 'MongoDB anonymous volume fixture is missing');
    return names;
}

async function assertRemoved(names) {
    for (const name of names) await assert.rejects(() => docker(['volume', 'inspect', name]), /failed/);
}

describe('Verification resource lifecycle', function () {
    this.timeout(120000);
    for (const fail of [false, true]) {
        it(`removes MongoDB anonymous volumes after ${fail ? 'failure' : 'success'}`, async function () {
            const runId = `meemo-lifecycle-${crypto.randomUUID()}`;
            const container = `${runId}-mongo`;
            let volumes;
            async function run() {
                try {
                    await startMongo(container, runId);
                    volumes = await anonymousVolumes(container);
                    if (fail) await docker(['exec', container, 'sh', '-c', 'exit 7']);
                } finally {
                    await removeOwned('container', container, runId);
                }
            }
            if (fail) await assert.rejects(run, /failed \(7\)/);
            else await run();
            await assertRemoved(volumes);
        });
    }

    for (const entry of ['restore', 'relevance']) for (const signal of ['SIGINT', 'SIGTERM']) {
        it(`cleans the real ${entry} entry point after ${signal}`, async function () {
            // verify-restore builds its image (up to 300s) before MongoDB starts; a cold build cache must not fail the wait.
            this.timeout(450000);
            const work = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-signal-test-'));
            const args = entry === 'restore' ? ['scripts/verify-restore.js'] : ['scripts/benchmark-search.js', '--relevance'];
            const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, TMPDIR: work }, stdio: ['ignore', 'ignore', 'pipe'] });
            const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
            let stderr = '';
            child.stderr.on('data', chunk => { stderr += chunk.toString(); });
            let runId;
            let volumes = [];
            let stopped = false;
            const timer = setTimeout(() => child.kill('SIGKILL'), 420000);
            try {
                const deadline = Date.now() + 360000;
                while (Date.now() < deadline) {
                    runId = stderr.match(/Verification run: (meemo-(?:restore|relevance)-[0-9a-f-]+)/)?.[1];
                    if (runId) {
                        const names = await docker(['container', 'ls', '-a', '--filter', `label=${label}=${runId}`, '--format', '{{.Names}}']);
                        const mongo = names.split('\n').find(name => name.endsWith('-mongo'));
                        if (mongo) { volumes = await anonymousVolumes(mongo); break; }
                    }
                    if (child.exitCode !== null) break;
                    await delay(100);
                }
                assert(runId && volumes.length, `No resources created before interruption: ${stderr}`);
                child.kill(signal);
                const result = await exited;
                stopped = true;
                assert.equal(result.signal, null, stderr);
                assert.equal(result.code, signal === 'SIGINT' ? 130 : 143, stderr);
                for (const type of ['container', 'volume', 'network', 'image']) {
                    const remaining = await docker([type, 'ls', ...(type === 'container' ? ['-a'] : []), '--filter', `label=${label}=${runId}`, '-q']);
                    assert.equal(remaining, '', `Leaked ${type} resources`);
                }
                await assertRemoved(volumes);
                assert.deepEqual(fs.readdirSync(work), [], 'Private restore workspace leaked');
            } finally {
                clearTimeout(timer);
                if (!stopped) { child.kill('SIGKILL'); await exited; }
                // Test cleanup is restricted to the child's exact announced ownership label.
                if (runId) {
                    for (const type of ['container', 'volume', 'network', 'image']) {
                        const format = type === 'image' ? '{{.Repository}}:{{.Tag}}' : type === 'container' ? '{{.Names}}' : '{{.Name}}';
                        const names = await docker([type, 'ls', ...(type === 'container' ? ['-a'] : []), '--filter', `label=${label}=${runId}`, '--format', format]);
                        for (const name of names.split('\n').filter(Boolean)) await removeOwned(type, name, runId);
                    }
                }
                fs.rmSync(work, { recursive: true, force: true });
            }
        });
    }
});
