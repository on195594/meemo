'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const label = 'meemo.verification';
let cancellation;

async function withSignals(run) {
    assert(!cancellation, 'A verification is already running in this process');
    const controller = new AbortController();
    cancellation = controller.signal;
    const interrupt = signal => {
        if (controller.signal.aborted) return;
        process.exitCode = signal === 'SIGINT' ? 130 : 143;
        controller.abort(new Error(`Interrupted by ${signal}`));
    };
    const onInt = () => interrupt('SIGINT');
    const onTerm = () => interrupt('SIGTERM');
    process.on('SIGINT', onInt);
    process.on('SIGTERM', onTerm);
    try {
        const result = await run();
        controller.signal.throwIfAborted();
        return result;
    } finally {
        process.removeListener('SIGINT', onInt);
        process.removeListener('SIGTERM', onTerm);
        cancellation = null;
    }
}

function signal() {
    return cancellation;
}

async function docker(args, options = {}) {
    const { signal: abort = cancellation, timeout = 120000, maxBuffer = 4 * 1024 * 1024, ...spawnOptions } = options;
    abort?.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn('docker', args, { cwd: root, ...spawnOptions });
        const chunks = [];
        let bytes = 0;
        let error;
        let forceKill;
        let terminating = false;
        function stop(reason) {
            error ||= reason;
            if (terminating) return;
            terminating = true;
            child.kill('SIGTERM');
            forceKill = setTimeout(() => child.kill('SIGKILL'), 2000);
        }
        const createsResource = args[0] === 'run' || ['network', 'volume'].includes(args[0]) && args[1] === 'create';
        const onAbort = () => {
            // Let an in-flight creation settle before cleanup inspects its name;
            // otherwise the daemon could create it after cleanup has already run.
            if (createsResource) error ||= abort.reason;
            else stop(abort.reason);
        };
        const timer = setTimeout(() => stop(new Error(`Docker ${args[0]} timed out`)), timeout);
        abort?.addEventListener('abort', onAbort, { once: true });
        if (abort?.aborted) onAbort();
        child.stdout?.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > maxBuffer) stop(new Error(`Docker ${args[0]} output limit exceeded`));
            else chunks.push(chunk);
        });
        child.stderr?.resume();
        child.on('error', failure => { error = new Error(`Docker ${args[0]} failed (${failure.code})`); });
        // Wait for the CLI to close before finally removes resources or archive files.
        child.on('close', code => {
            clearTimeout(timer);
            clearTimeout(forceKill);
            abort?.removeEventListener('abort', onAbort);
            // Do not print command arguments: container environments may contain secrets.
            if (error || code !== 0) reject(error || new Error(`Docker ${args[0]} failed (${code})`));
            else resolve(Buffer.concat(chunks).toString('utf8').trim());
        });
    });
}

async function waitFor(check, description) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        cancellation?.throwIfAborted();
        try {
            await check();
            return;
        } catch {
            cancellation?.throwIfAborted();
            await delay(500, undefined, { signal: cancellation || undefined });
        }
    }
    throw new Error(`Timed out waiting for ${description}`);
}

async function port(container, internalPort) {
    const ports = JSON.parse(await docker(['inspect', container, '--format', '{{json .NetworkSettings.Ports}}']));
    const bindings = ports[`${internalPort}/tcp`];
    assert(Array.isArray(bindings), 'Published loopback port is missing');
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].HostIp, '127.0.0.1');
    const value = Number(bindings[0].HostPort);
    assert(Number.isInteger(value) && value > 0 && value <= 65535, 'Invalid published port');
    return value;
}

async function startMongo(name, runId, network) {
    const args = ['run', '-d', '--name', name, '--label', `${label}=${runId}`, '-p', '127.0.0.1::27017'];
    if (network) args.push('--network', network);
    await docker([...args, 'mongo:8']);
    await waitFor(() => docker(['exec', name, 'mongosh', '--quiet', '--eval', 'quit(db.adminCommand({ping:1}).ok ? 0 : 1)'], { timeout: 5000 }), name);
    return `mongodb://127.0.0.1:${await port(name, 27017)}/`;
}

function assertOwned(actual, runId) {
    assert.equal(actual, runId, 'Refusing to clean up a resource owned by another run');
}

async function removeOwned(type, name, runId) {
    // Cancellation stops work, not cleanup. Keep the ownership check on every path.
    const cleanup = { signal: null };
    let owner;
    try {
        const field = type === 'container' || type === 'image' ? '.Config.Labels' : '.Labels';
        owner = await docker([type, 'inspect', name, '--format', `{{index ${field} "${label}"}}`], cleanup);
    } catch {
        const format = type === 'container' ? '{{.Names}}' : type === 'image' ? '{{.Repository}}:{{.Tag}}' : '{{.Name}}';
        const names = await docker([type, 'ls', '--format', format, ...(type === 'container' ? ['-a'] : [])], cleanup);
        assert(!names.split('\n').includes(name), `Could not inspect ${type} ${name}`);
        return;
    }
    assertOwned(owner, runId);
    // -v removes the mongo image's anonymous /data/db and /data/configdb volumes;
    // explicitly named application volumes still go through their own ownership checks.
    await docker([type, 'rm', ...(type === 'container' ? ['-f', '-v'] : []), name], cleanup);
}

module.exports = { root, label, docker, waitFor, port, startMongo, assertOwned, removeOwned, withSignals, signal };
