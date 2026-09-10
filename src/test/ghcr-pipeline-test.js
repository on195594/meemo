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

describe('GHCR Release Pipeline and Multi-Arch Buildx (RF-601)', function () {
    var rootDir = path.resolve(__dirname, '../..');

    describe('Dockerfile Multi-Arch & BuildKit optimizations', function () {
        var dockerfile = fs.readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');

        it('optimizes web-builder stage with native BUILDPLATFORM', function () {
            expect(dockerfile).to.contain('FROM --platform=$BUILDPLATFORM alpine:${ALPINE_VERSION} AS web-builder');
        });

        it('compiles native backend dependencies on target platform with alpine g++', function () {
            expect(dockerfile).to.contain('FROM alpine:${ALPINE_VERSION} AS builder');
            expect(dockerfile).to.contain('RUN npm ci --omit=dev');
        });

        it('specifies standard OCI image labels', function () {
            expect(dockerfile).to.contain('org.opencontainers.image.authors');
            expect(dockerfile).to.contain('org.opencontainers.image.created');
            expect(dockerfile).to.contain('org.opencontainers.image.version');
            expect(dockerfile).to.contain('org.opencontainers.image.revision');
            expect(dockerfile).to.contain('org.opencontainers.image.source');
            expect(dockerfile).to.contain('org.opencontainers.image.title');
        });
    });

    describe('Master Edge GHCR Workflow (.github/workflows/buildx-latest.yml)', function () {
        var workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/buildx-latest.yml'), 'utf8'),
            config = loadWorkflow(rootDir, 'buildx-latest.yml');

        it('publishes only after a successful master validation run', function () {
            expect(config.on.workflow_run.workflows).to.contain('Validation quality gate');
            expect(config.on.workflow_run.branches).to.contain('master');
            expect(config.jobs['build-and-push'].if).to.contain("conclusion == 'success'");
            expect(config.jobs['build-and-push'].if).to.contain("event == 'push'");
        });

        it('configures permissions for GHCR package publishing', function () {
            expect(workflow).to.contain('packages: write');
        });

        it('sets up QEMU and Buildx for cross-platform builds', function () {
            expect(workflow).to.contain('docker/setup-qemu-action@v3');
            expect(workflow).to.contain('docker/setup-buildx-action@v3');
        });

        it('logs in to GitHub Container Registry', function () {
            expect(workflow).to.contain('registry: ghcr.io');
            expect(workflow).to.contain('secrets.GITHUB_TOKEN');
        });

        it('extracts edge tags and short sha', function () {
            expect(workflow).to.contain('docker/metadata-action@v5');
            expect(workflow).to.contain('type=edge,branch=master');
            expect(workflow).to.contain('type=sha,prefix=edge-,format=short');
        });

        it('builds and pushes multi-arch image (linux/amd64, linux/arm64) with SBOM and provenance', function () {
            expect(workflow).to.contain('platforms: linux/amd64,linux/arm64');
            expect(workflow).to.contain('push: true');
            expect(workflow).to.contain('sbom: true');
            expect(workflow).to.contain('provenance: mode=max');
        });
    });

    describe('Release GHCR Workflow (.github/workflows/buildx-release.yml)', function () {
        var workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/buildx-release.yml'), 'utf8'),
            config = loadWorkflow(rootDir, 'buildx-release.yml');

        it('triggers on published release', function () {
            expect(workflow).to.contain('types: [published]');
        });

        it('configures permissions for GHCR package publishing', function () {
            expect(workflow).to.contain('packages: write');
        });

        it('requires the validation quality gate before publishing', function () {
            expect(config.jobs.validation.uses).to.be('./.github/workflows/build.yml');
            expect(config.jobs['build-and-push-release'].needs).to.be('validation');
        });

        it('extracts semantic version tags and latest tag', function () {
            expect(workflow).to.contain('docker/metadata-action@v5');
            expect(workflow).to.contain('type=semver,pattern={{version}}');
            expect(workflow).to.contain('type=semver,pattern={{major}}.{{minor}}');
            expect(workflow).to.contain('type=raw,value=latest');
        });

        it('builds and pushes multi-arch release image with SBOM and provenance', function () {
            expect(workflow).to.contain('platforms: linux/amd64,linux/arm64');
            expect(workflow).to.contain('push: true');
            expect(workflow).to.contain('sbom: true');
            expect(workflow).to.contain('provenance: mode=max');
            expect(workflow).to.contain('VERSION=${{ github.ref_name }}');
        });
    });

    describe('Master and PR Validation Quality Gate (.github/workflows/build.yml)', function () {
        var config = loadWorkflow(rootDir, 'build.yml'),
            packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'web/package.json'), 'utf8'));

        it('runs for master pushes, master pull requests, and publish callers', function () {
            expect(config.on.push.branches).to.contain('master');
            expect(config.on.pull_request.branches).to.contain('master');
            expect(config.on).to.have.property('workflow_call');
        });

        it('exposes frontend, test, docker, and integration checks', function () {
            ['frontend', 'test', 'docker', 'integration'].forEach(function (job) {
                expect(config.jobs).to.have.property(job);
            });
        });

        it('uses clean installs and runs the Vue type checker', function () {
            expect(jobCommands(config.jobs.frontend)).to.contain('npm --prefix web ci');
            expect(jobCommands(config.jobs.frontend)).to.contain('npm --prefix web run typecheck');
            expect(jobCommands(config.jobs.test)).to.contain('npm ci');
            expect(packageJson.scripts.typecheck).to.be('vue-tsc --noEmit');
        });

        it('builds Docker and smoke-tests every required endpoint', function () {
            var integration = jobCommands(config.jobs.integration);

            expect(jobCommands(config.jobs.docker)).to.contain('docker build');
            expect(integration).to.contain('docker compose up --build -d');
            ['/api/health/ready', '/api/register', '/api/login', '/api/profile', '/api/things']
                .forEach(function (endpoint) { expect(integration).to.contain(endpoint); });
        });
    });
});
