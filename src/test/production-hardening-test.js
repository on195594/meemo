'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    appModule = require('../../app.js'),
    createApp = appModule.createApp,
    startServer = appModule.startServer;

describe('Production Deployment Hardening (RF-602)', function () {
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
});
