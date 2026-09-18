#!/usr/bin/env node

'use strict';

const { spawnSync } = require('node:child_process');

function run(label, command, args) {
    console.log(`\n==> ${label}`);
    const result = spawnSync(command, args, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit'
    });

    if (result.error) {
        console.error(`Verification step could not start: ${result.error.message}`);
        process.exit(result.error.code || 1);
    }
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function npm(...args) {
    run(args.join(' '), process.platform === 'win32' ? 'npm.cmd' : 'npm', args);
}

function verifyQuality() {
    npm('run', 'api:generate');
    run('generated API types are up to date', 'git', ['diff', '--exit-code', '--', 'types/generated/api-types.ts']);
    npm('--prefix', 'web', 'run', 'typecheck');
    npm('--prefix', 'web', 'test');
    npm('run', 'build');
    npm('test');
}

if (process.argv[2] === '--quality') {
    verifyQuality();
} else {
    verifyQuality();
    npm('run', 'verify:integration');
}

console.log('\nVerification passed.');
