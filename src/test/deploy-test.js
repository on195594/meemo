'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('Application-only deployment', function () {
    for (const scenario of ['success', 'build-failure', 'unhealthy', 'wrong-image']) {
        it(scenario, function () {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'meemo-deploy-test-'));
            const stateFile = path.join(directory, 'state.json');
            const shim = `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), assert = require('assert/strict');
const args = process.argv.slice(2);
if (path.basename(process.argv[1]) === 'git') {
    if (args.includes('rev-parse')) console.log('test-revision');
    process.exit(0);
}
const state = JSON.parse(fs.readFileSync(process.env.DEPLOY_TEST_STATE, 'utf8'));
const scenario = process.env.DEPLOY_TEST_SCENARIO;
let status = 0;
if (args[0] === 'build') {
    state.builds++;
    assert(args.includes('COMMIT=test-revision'));
    if (scenario === 'build-failure') status = 1;
    else state.latest = 'new-image';
} else if (args[0] === 'inspect') console.log(state.running);
else if (args[0] === 'image' && args[1] === 'inspect') console.log(state.latest);
else if (args[0] === 'tag') {
    assert.deepEqual(args, ['tag', 'old-image', 'meemo:latest']);
    state.latest = 'old-image';
} else if (args[0] === 'compose') {
    assert.deepEqual(args.slice(1, 3), ['--project-directory', '/home/lin/meemo']);
    if (args[3] === 'ps') console.log('meemo-container');
    else {
        assert.deepEqual(args.slice(3), ['up', '-d', '--no-deps', '--no-build', '--wait', '--wait-timeout', '60', 'meemo']);
        state.up++;
        state.running = state.latest;
        if (state.up === 1 && scenario === 'unhealthy') status = 1;
        if (state.up === 1 && scenario === 'wrong-image') state.running = 'unexpected-image';
    }
} else throw Error('Unexpected Docker operation');
fs.writeFileSync(process.env.DEPLOY_TEST_STATE, JSON.stringify(state));
process.exit(status);
`;
            try {
                for (const name of ['docker', 'git']) fs.writeFileSync(path.join(directory, name), shim, { mode: 0o700 });
                fs.writeFileSync(stateFile, JSON.stringify({ latest: 'old-image', running: 'old-image', builds: 0, up: 0 }));
                const result = spawnSync('bash', [path.resolve(__dirname, '../../deploy.sh')], {
                    env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH,
                        DEPLOY_TEST_STATE: stateFile, DEPLOY_TEST_SCENARIO: scenario },
                    encoding: 'utf8', timeout: 5000
                });
                assert.ifError(result.error);
                const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
                assert.equal(result.status, scenario === 'success' ? 0 : 1, result.stderr);
                assert.equal(state.builds, 1);
                assert.equal(state.up, scenario === 'success' ? 1 : scenario === 'build-failure' ? 0 : 2);
                assert.equal(state.running, scenario === 'success' ? 'new-image' : 'old-image');
            } finally {
                fs.rmSync(directory, { recursive: true, force: true });
            }
        });
    }
});
