'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js'),
    request = require('supertest'),
    createApp = require('../../app.js').createApp;

describe('Vue 3 Cutover and Legacy Retirement (RF-506)', function () {
    var rootDir = path.resolve(__dirname, '../..');
    var app = createApp({ sessionMemory: true, sessionSecret: 'rf-506-cutover-secret' });

    describe('Legacy Retirement', function () {
        it('removes legacy frontend directory and gulpfile', function () {
            expect(fs.existsSync(path.join(rootDir, 'frontend'))).to.be(false);
            expect(fs.existsSync(path.join(rootDir, 'gulpfile.js'))).to.be(false);
        });

        it('cleans legacy Gulp, Sass, jQuery, and Vue 1 from root package.json devDependencies', function () {
            var pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
            expect(pkg.devDependencies).not.to.have.property('gulp');
            expect(pkg.devDependencies).not.to.have.property('gulp-sass');
            expect(pkg.devDependencies).not.to.have.property('gulp-autoprefixer');
            expect(pkg.devDependencies).not.to.have.property('gulp-cssnano');
            expect(pkg.devDependencies).not.to.have.property('gulp-ejs');
            expect(pkg.devDependencies).not.to.have.property('jquery');
            expect(pkg.devDependencies).not.to.have.property('vue');
            expect(pkg.devDependencies).not.to.have.property('sass');
            expect(pkg.devDependencies).not.to.have.property('yargs');

            expect(pkg.scripts.build).to.equal('node scripts/build-frontend.js');
        });
    });

    describe('Modern Vue 3 SPA Build Artifacts', function () {
        it('has modern Vue 3 SPA build output in public directory', function () {
            var publicDir = path.join(rootDir, 'public');
            expect(fs.existsSync(publicDir)).to.be(true);
            expect(fs.existsSync(path.join(publicDir, 'index.html'))).to.be(true);
            expect(fs.existsSync(path.join(publicDir, 'favicon.png'))).to.be(true);

            var indexHtml = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
            expect(indexHtml).to.contain('<div id="app"></div>');
            expect(indexHtml).to.contain('/assets/');

            var assetsDir = path.join(publicDir, 'assets');
            expect(fs.existsSync(assetsDir)).to.be(true);
            var assetFiles = fs.readdirSync(assetsDir);
            expect(assetFiles.some(function (f) { return f.endsWith('.js'); })).to.be(true);
            expect(assetFiles.some(function (f) { return f.endsWith('.css'); })).to.be(true);
        });
    });

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
