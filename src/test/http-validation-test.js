'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    request = require('supertest'),
    createApp = require('../../app.js').createApp,
    responses = require('../http/responses.js');

describe('HTTP modules and validation (RF-302)', function () {
    var app = createApp({ sessionMemory: true, sessionSecret: 'rf-302-test-secret' });

    it('returns a stable validation error for invalid request bodies', function (done) {
        request(app)
            .post('/api/login')
            .send({ username: 42, password: 'password123' })
            .expect(400)
            .end(function (error, res) {
                expect(error).to.be(null);
                expect(res.body.code).to.equal('invalid_request');
                expect(res.body.message).to.equal('missing username or password');
                done();
            });
    });

    it('keeps legacy attachment descriptors compatible while validating paths', function () {
        var schema = require('../http/routes/things.js').schemas.create;
        var parsed = schema.parse({ content: 'legacy note', attachments: ['legacy-file.png'] });

        expect(parsed.attachments).to.eql(['legacy-file.png']);
        expect(function () {
            schema.parse({ content: 'bad note', attachments: ['../private-file'] });
        }).to.throwError();
    });

    it('accepts supported note colors and rejects unknown colors', function () {
        var schema = require('../http/routes/things.js').schemas.create;

        expect(schema.parse({ content: 'colored note', color: 'coral' }).color).to.equal('coral');
        expect(function () {
            schema.parse({ content: 'bad color', color: 'red' });
        }).to.throwError();
    });

    it('maps authentication and not-found failures to stable error codes', function (done) {
        request(app)
            .get('/api/things')
            .expect(401)
            .end(function (error, res) {
                expect(error).to.be(null);
                expect(res.body.code).to.equal('authentication_required');

                request(app)
                    .get('/api/does-not-exist')
                    .expect(404)
                    .end(function (notFoundError, notFoundRes) {
                        expect(notFoundError).to.be(null);
                        expect(notFoundRes.body.code).to.equal('not_found');
                        done();
                    });
            });
    });

    it('maps malformed JSON to invalid_request', function (done) {
        request(app)
            .post('/api/login')
            .set('Content-Type', 'application/json')
            .send('{')
            .expect(400)
            .end(function (error, res) {
                expect(error).to.be(null);
                expect(res.body.code).to.equal('invalid_request');
                expect(res.body.message).to.equal('Failed to parse body');
                done();
            });
    });

    it('does not expose internal error details', function () {
        var body;
        var originalConsoleError = console.error;
        console.error = function () {};

        try {
            responses.errorHandler(new Error('Mongo failed at /private/data/users'), {}, {
                headersSent: false,
                status: function (status) {
                    expect(status).to.equal(500);
                    return this;
                },
                send: function (value) {
                    body = value;
                }
            }, function () {});
        } finally {
            console.error = originalConsoleError;
        }

        expect(body.code).to.equal('internal_error');
        expect(body.message).to.equal('Internal server error');
        expect(JSON.stringify(body)).not.to.contain('/private/data/users');
    });
});
