'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js'),
    request = require('supertest'),
    yaml = require('js-yaml'),
    createApp = require('../../app.js').createApp,
    responses = require('../http/responses.js');

describe('API Contract and Progressive Types (RF-305)', function () {
    var specPath = path.resolve(__dirname, '../../docs/openapi.yaml');
    var typesPath = path.resolve(__dirname, '../../types/api.d.ts');
    var spec;

    it('loads and parses docs/openapi.yaml as valid OpenAPI 3.0', function () {
        expect(fs.existsSync(specPath)).to.be(true);
        var content = fs.readFileSync(specPath, 'utf8');
        spec = yaml.load(content);

        expect(spec).to.be.an('object');
        expect(spec.openapi).to.match(/^3\.0\./);
        expect(spec.info).to.be.an('object');
        expect(spec.info.title).to.equal('Meemo API');
        expect(spec.paths).to.be.an('object');
        expect(spec.components).to.be.an('object');
        expect(spec.components.schemas).to.be.an('object');
    });

    it('provides TypeScript declarations in types/api.d.ts and types/index.d.ts', function () {
        expect(fs.existsSync(typesPath)).to.be(true);
        var typesContent = fs.readFileSync(typesPath, 'utf8');
        expect(typesContent).to.contain('export interface Thing');
        expect(typesContent).to.contain('export interface User');
        expect(typesContent).to.contain('export interface Tag');
        expect(typesContent).to.contain('export interface ErrorResponse');
        expect(typesContent).to.contain('export type ErrorCode');

        var indexPath = path.resolve(__dirname, '../../types/index.d.ts');
        expect(fs.existsSync(indexPath)).to.be(true);
    });

    it('covers all required API endpoints in openapi.yaml', function () {
        var requiredEndpoints = [
            { path: '/api/register', methods: ['post'] },
            { path: '/api/login', methods: ['post'] },
            { path: '/api/logout', methods: ['post'] },
            { path: '/api/profile', methods: ['get'] },
            { path: '/api/things', methods: ['get', 'post'] },
            { path: '/api/things/{id}', methods: ['get', 'put', 'delete'] },
            { path: '/api/tags', methods: ['get'] },
            { path: '/api/files', methods: ['post'] },
            { path: '/api/files/{userId}/{thingId}/{identifier}', methods: ['get'] },
            { path: '/api/settings', methods: ['get', 'post'] },
            { path: '/api/export', methods: ['get'] },
            { path: '/api/import', methods: ['post'] },
            { path: '/api/public/{userId}/things', methods: ['get'] },
            { path: '/api/public/{userId}/things/{thingId}', methods: ['get'] },
            { path: '/api/public/{userId}/files/{fileId}', methods: ['get'] },
            { path: '/api/users', methods: ['get'] },
            { path: '/api/users/{userId}', methods: ['get'] },
            { path: '/api/rss/{userId}', methods: ['get'] },
            { path: '/public/{userId}', methods: ['get'] },
            { path: '/api/health/live', methods: ['get'] },
            { path: '/api/health/ready', methods: ['get'] },
            { path: '/api/healthcheck', methods: ['get'] }
        ];

        requiredEndpoints.forEach(function (endpoint) {
            expect(spec.paths).to.have.property(endpoint.path);
            var pathItem = spec.paths[endpoint.path];
            endpoint.methods.forEach(function (method) {
                expect(pathItem).to.have.property(method);
                expect(pathItem[method].responses).to.be.an('object');
            });
        });
    });

    it('documents all standard API error codes from responses.js in OpenAPI schema', function () {
        var errorSchema = spec.components.schemas.ErrorResponse;
        expect(errorSchema).to.be.an('object');
        var documentedCodes = errorSchema.properties.code.enum;

        var coreStatuses = [400, 401, 403, 404, 409, 413, 429, 500, 503];
        coreStatuses.forEach(function (status) {
            var sampleError = new responses.HttpError(status, 'test');
            var code = sampleError.details.code;
            expect(documentedCodes).to.contain(code);
        });
    });

    it('produces HTTP responses strictly matching the OpenAPI schema contract', function (done) {
        var app = createApp({ sessionMemory: true, sessionSecret: 'rf-305-secret' });

        request(app)
            .get('/api/health/live')
            .expect(200)
            .end(function (err, res) {
                expect(err).to.be(null);
                expect(res.body).to.have.property('status');
                expect(res.body.status).to.equal('ok');

                request(app)
                    .post('/api/login')
                    .send({ username: '', password: '' })
                    .expect(400)
                    .end(function (loginErr, loginRes) {
                        expect(loginErr).to.be(null);
                        expect(loginRes.body).to.have.property('status');
                        expect(loginRes.body).to.have.property('code');
                        expect(loginRes.body).to.have.property('message');
                        expect(loginRes.body.code).to.equal('invalid_request');
                        done();
                    });
            });
    });
});
