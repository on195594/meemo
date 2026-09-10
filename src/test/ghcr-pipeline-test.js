'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

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
        var workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/buildx-latest.yml'), 'utf8');

        it('triggers on master push', function () {
            expect(workflow).to.contain('branches: [master]');
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
        var workflow = fs.readFileSync(path.join(rootDir, '.github/workflows/buildx-release.yml'), 'utf8');

        it('triggers on published release', function () {
            expect(workflow).to.contain('types: [published]');
        });

        it('configures permissions for GHCR package publishing', function () {
            expect(workflow).to.contain('packages: write');
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
});
