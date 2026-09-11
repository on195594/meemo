'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js'),
    yaml = require('js-yaml');

function loadWorkflow(rootDir, fileName) {
    return yaml.load(fs.readFileSync(path.join(rootDir, '.github/workflows', fileName), 'utf8'), {
        schema: yaml.JSON_SCHEMA
    });
}

function jobCommands(job) {
    return job.steps.map(function (step) { return step.run || ''; }).join('\n');
}

describe('RC release gate and multi-arch pipeline (RF-717)', function () {
    var rootDir = path.resolve(__dirname, '../..'),
        workflowDir = path.join(rootDir, '.github/workflows');

    it('keeps one validation workflow and one release workflow', function () {
        expect(fs.existsSync(path.join(workflowDir, 'ci.yml'))).to.be(true);
        expect(fs.existsSync(path.join(workflowDir, 'release.yml'))).to.be(true);
        expect(fs.existsSync(path.join(workflowDir, 'build.yml'))).to.be(false);
        expect(fs.existsSync(path.join(workflowDir, 'buildx-latest.yml'))).to.be(false);
        expect(fs.existsSync(path.join(workflowDir, 'buildx-release.yml'))).to.be(false);
    });

    describe('RC validation gate', function () {
        var config = loadWorkflow(rootDir, 'ci.yml'),
            source = fs.readFileSync(path.join(workflowDir, 'ci.yml'), 'utf8'),
            packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'web/package.json'), 'utf8'));

        it('runs on master, pull requests, and release workflow calls', function () {
            expect(config.on.push.branches).to.contain('master');
            expect(config.on.pull_request.branches).to.contain('master');
            expect(config.on).to.have.property('workflow_call');
        });

        it('runs clean install, API generation, typecheck, build, and tests', function () {
            var quality = jobCommands(config.jobs.quality);
            ['npm ci', 'npm --prefix web ci', 'npm run api:generate',
                'npm --prefix web run typecheck', 'npm run build', 'npm test']
                .forEach(function (command) { expect(quality).to.contain(command); });
            expect(packageJson.scripts.typecheck).to.be('vue-tsc --noEmit');
        });

        it('smoke-tests every RC release path through Compose', function () {
            var integration = jobCommands(config.jobs.integration);
            ['docker compose up --build -d', '/api/health/ready', '/api/register', '/api/login',
                '/api/profile', '/api/things', '/api/files', '/api/public/', '/public/',
                '/api/export', '/api/import', 'docker compose down -v']
                .forEach(function (value) { expect(integration).to.contain(value); });
        });

        it('builds both supported image architectures without publishing', function () {
            expect(config.jobs.docker.strategy.matrix.platform).to.eql(['linux/amd64', 'linux/arm64']);
            expect(source).to.contain('docker/setup-qemu-action@v3');
            expect(source).to.contain('docker/setup-buildx-action@v3');
            expect(source).to.contain('docker/build-push-action@v5');
            expect(source).to.contain('push: false');
        });
    });

    describe('RC release workflow', function () {
        var config = loadWorkflow(rootDir, 'release.yml'),
            source = fs.readFileSync(path.join(workflowDir, 'release.yml'), 'utf8'),
            publish = config.jobs.publish;

        it('publishes only after the reusable validation gate passes', function () {
            expect(config.on).to.have.property('workflow_dispatch');
            expect(config.on).not.to.have.property('release');
            expect(config.jobs.validation.uses).to.be('./.github/workflows/ci.yml');
            expect(publish.needs).to.be('validation');
            expect(source).to.contain('packages: write');
            expect(source.indexOf('Build and push multi-arch RC image'))
                .to.be.lessThan(source.indexOf('Publish GitHub prerelease'));
        });

        it('publishes multi-arch images with SBOM and provenance', function () {
            expect(source).to.contain('platforms: linux/amd64,linux/arm64');
            expect(source).to.contain('push: true');
            expect(source).to.contain('sbom: true');
            expect(source).to.contain('provenance: mode=max');
            expect(source).to.contain('VERSION=${{ steps.release.outputs.tag }}');
        });

        it('enforces exact immutable RC tags without moving stable aliases', function () {
            var commands = jobCommands(publish);
            expect(commands).to.contain('^v[0-9]+\\.[0-9]+\\.[0-9]+-rc[0-9]+$');
            expect(commands).to.contain('RC releases must run from the current master commit');
            expect(commands).to.contain('git ls-remote --exit-code --tags');
            expect(commands).to.contain('|| tag_status=$?');
            expect(commands).to.contain('Could not verify Git tag absence');
            expect(commands).to.contain('2) ;;');
            expect(commands).to.contain('Could not verify GHCR tag absence');
            expect(commands).to.contain('404)');
            expect(source).to.contain('${{ steps.release.outputs.image }}:${{ steps.release.outputs.version }}');
            ['type=raw,value=latest', 'pattern={{major}}', 'pattern={{minor}}'].forEach(function (alias) {
                expect(source).not.to.contain(alias);
            });
        });

        it('pins every third-party action that can publish', function () {
            publish.steps.filter(function (step) { return step.uses; }).forEach(function (step) {
                expect(step.uses).to.match(/@[0-9a-f]{40}$/);
            });
        });
    });

    it('documents executable backup, restore, migration, deployment, and rollback gates', function () {
        var checklist = fs.readFileSync(path.join(rootDir, 'docs', 'RELEASE_CHECKLIST.md'), 'utf8'),
            runbook = fs.readFileSync(path.join(rootDir, 'docs', 'BACKUP_RESTORE.md'), 'utf8');
        expect(runbook).to.contain("docker inspect --format '{{.Image}}'");
        expect(runbook).to.contain("{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}");
        ['dry-run', 'apply', 'verify', 'immutable image digest', 'Rollback',
            'BACKUP_RESTORE.md'].forEach(function (value) {
            expect(checklist).to.contain(value);
        });
        ['mongodump', 'mongorestore', '/app/data', 'sha256sum -c',
            'clean isolated stack', 'same MongoDB major version'].forEach(function (value) {
            expect(runbook).to.contain(value);
        });
    });
});
