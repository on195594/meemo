'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js'),
    request = require('supertest'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp,
    startServer = appModule.startServer;

describe('Production Deployment Hardening (RF-602)', function () {
    var rootDir = path.resolve(__dirname, '../..');

    describe('Fail-fast on missing production secret', function () {
        it('throws immediately in createApp when NODE_ENV=production and SESSION_SECRET is missing', function () {
            expect(function () {
                createApp({ isProduction: true, sessionSecret: '' });
            }).to.throwError(/FATAL: SESSION_SECRET is required/);
        });

        it('throws immediately in startServer when isProduction is true and SESSION_SECRET is missing', async function () {
            var threw = false;
            try {
                await startServer({ isProduction: true, sessionSecret: '' });
            } catch (err) {
                threw = true;
                expect(err.message).to.contain('FATAL: SESSION_SECRET is required');
            }
            expect(threw).to.be(true);
        });
    });

    describe('Fail-fast on non-mongo authentication source in production', function () {
        var users = require('../users.js');

        it('throws immediately in createApp when isProduction is true and authUserSource is file or fallback', function () {
            expect(function () {
                createApp({ isProduction: true, sessionSecret: 'test-secret', authUserSource: 'file' });
            }).to.throwError(/FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production/);

            expect(function () {
                createApp({ isProduction: true, sessionSecret: 'test-secret', authUserSource: 'fallback' });
            }).to.throwError(/FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production/);
        });

        it('throws immediately in startServer when isProduction is true and authUserSource is not mongo', async function () {
            var threw = false;
            try {
                await startServer({ isProduction: true, sessionSecret: 'test-secret', authUserSource: 'file' });
            } catch (err) {
                threw = true;
                expect(err.message).to.contain('FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production');
            }
            expect(threw).to.be(true);
        });

        it('throws in users createRepository when NODE_ENV=production and source is not mongo', function () {
            var originalNodeEnv = process.env.NODE_ENV;
            var originalSource = process.env.AUTH_USER_SOURCE;
            try {
                process.env.NODE_ENV = 'production';
                process.env.AUTH_USER_SOURCE = 'file';
                expect(function () {
                    users.initRepository();
                }).to.throwError(/FATAL: AUTH_USER_SOURCE must be mongo when NODE_ENV=production/);
            } finally {
                if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
                else delete process.env.NODE_ENV;
                if (originalSource !== undefined) process.env.AUTH_USER_SOURCE = originalSource;
                else delete process.env.AUTH_USER_SOURCE;
                users.initRepository();
            }
        });

        it('throws on unsupported AUTH_USER_SOURCE value', function () {
            var originalSource = process.env.AUTH_USER_SOURCE;
            try {
                process.env.AUTH_USER_SOURCE = 'unsupported-source';
                expect(function () {
                    users.initRepository();
                }).to.throwError(/Unsupported AUTH_USER_SOURCE/);
            } finally {
                if (originalSource !== undefined) process.env.AUTH_USER_SOURCE = originalSource;
                else delete process.env.AUTH_USER_SOURCE;
                users.initRepository();
            }
        });
    });

    describe('Readiness probe dependency failure detection', function () {
        it('returns 503 when database is disconnected or ping fails', async function () {
            var app = createApp({ sessionMemory: true, sessionSecret: 'hardening-test-secret' });
            var config = require('../config.js');
            var originalDb = config.db;

            try {
                config.db = null;
                var res = await request(app).get('/api/health/ready').expect(503);
                expect(res.body.code).to.equal('service_unavailable');
                expect(res.body.message).to.contain('Database not connected');
            } finally {
                config.db = originalDb;
            }
        });
    });

    describe('Dockerfile production security defaults', function () {
        var dockerfile = fs.readFileSync(path.join(rootDir, 'Dockerfile'), 'utf8');

        it('enforces non-root user execution (1000:1000)', function () {
            expect(dockerfile).to.contain('USER 1000:1000');
        });

        it('probes /api/health/ready for comprehensive readiness checks', function () {
            expect(dockerfile).to.contain('http://127.0.0.1:${PORT}/api/health/ready');
        });
    });

    describe('Docker Compose security options and isolation', function () {
        var composeContent = fs.readFileSync(path.join(rootDir, 'docker-compose.yml'), 'utf8');

        it('enforces read-only root filesystem on meemo service', function () {
            expect(composeContent).to.contain('read_only: true');
        });

        it('mounts tmpfs on /tmp with noexec and nosuid', function () {
            expect(composeContent).to.contain('/tmp:rw,noexec,nosuid');
        });

        it('drops all Linux capabilities and prevents privilege escalation', function () {
            expect(composeContent).to.contain('no-new-privileges:true');
            expect(composeContent).to.contain('cap_drop:');
            expect(composeContent).to.contain('- ALL');
        });

        it('enforces required SESSION_SECRET parameter expansion', function () {
            expect(composeContent).to.contain('${SESSION_SECRET:?');
        });

        it('keeps mongodb isolated without exposing ports to host', function () {
            var mongoSection = composeContent.split('\n  mongodb:')[1].split('\nvolumes:')[0];
            expect(mongoSection).not.to.contain('ports:');
            expect(mongoSection).to.contain('networks:');
            expect(mongoSection).to.contain('- backend');
        });
    });
});
