'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    request = require('supertest'),
    createApp = require('../../app.js').createApp;

describe('HTTP static serving', function () {
    var app = createApp({ sessionMemory: true, sessionSecret: 'static-serving-test-secret' });

    describe('Express Static Serving and SPA History Routing', function () {
        it('serves SPA index.html on root path /', function (done) {
            request(app)
                .get('/')
                .expect(200)
                .expect('Content-Type', /text\/html/)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.contain('<div id="app"></div>');
                    done();
                });
        });

        it('serves SPA index.html on public stream route /public/:userId', function (done) {
            request(app)
                .get('/public/60c72b2f9b1d8b001c8a1234')
                .expect(200)
                .expect('Content-Type', /text\/html/)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.contain('<div id="app"></div>');
                    done();
                });
        });

        it('validates userId path segment using safePathSegment schema', function () {
            var validation = require('../http/middleware/validate.js');
            expect(validation.safePathSegment.safeParse('valid-user-id').success).to.be(true);
            expect(validation.safePathSegment.safeParse('..').success).to.be(false);
            expect(validation.safePathSegment.safeParse('.').success).to.be(false);
            expect(validation.safePathSegment.safeParse('user/evil').success).to.be(false);
        });

        it('falls back to SPA index.html for shared note route /shared/:thingId', function (done) {
            request(app)
                .get('/shared/60c72b2f9b1d8b001c8a1234')
                .expect(200)
                .expect('Content-Type', /text\/html/)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.contain('<div id="app"></div>');
                    done();
                });
        });

        it('falls back to SPA index.html for non-asset deep client paths', function (done) {
            request(app)
                .get('/deep/client/route')
                .expect(200)
                .expect('Content-Type', /text\/html/)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).to.contain('<div id="app"></div>');
                    done();
                });
        });

        it('returns 404 JSON for non-existent API routes without serving index.html', function (done) {
            request(app)
                .get('/api/does-not-exist')
                .expect(404)
                .expect('Content-Type', /json/)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.body.code).to.equal('not_found');
                    done();
                });
        });

        it('returns 404 for missing static files with extensions', function (done) {
            request(app)
                .get('/assets/missing-bundle-file.js')
                .expect(404)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.text).not.to.contain('<div id="app"></div>');
                    done();
                });
        });

        it('applies no-cache and etag to index.html', function (done) {
            request(app)
                .get('/')
                .expect(200)
                .expect('Cache-Control', 'no-cache')
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers.etag).to.be.ok();
                    done();
                });
        });

        it('does not apply immutable cache-control to root static assets like favicon.png', function (done) {
            request(app)
                .get('/favicon.png')
                .expect(200)
                .end(function (err, res) {
                    expect(err).to.be(null);
                    expect(res.headers['cache-control'] || '').not.to.contain('immutable');
                    done();
                });
        });
    });
});
