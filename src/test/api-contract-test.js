'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js'),
    request = require('supertest'),
    yaml = require('js-yaml'),
    createApp = require('../../app.js').createApp,
    responses = require('../http/responses.js'),
    authService = require('../services/auth-service.js'),
    sharingService = require('../services/sharing-service.js'),
    settingsService = require('../services/settings-service.js'),
    thingService = require('../services/thing-service.js'),
    users = require('../users.js');

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

    it('documents the public user response contracts exactly', function () {
        var profileSchema = spec.components.schemas.PublicUserProfile;
        expect(profileSchema.additionalProperties).to.be(false);
        expect(Object.keys(profileSchema.properties)).to.eql(['id', 'username', 'displayName']);

        var userResponse = spec.paths['/api/users/{userId}'].get.responses['200']
            .content['application/json'].schema;
        expect(Object.keys(userResponse.properties)).to.eql(['user']);

        var usersResponse = spec.paths['/api/users'].get.responses['200']
            .content['application/json'].schema;
        expect(usersResponse.properties.users.items.$ref)
            .to.equal('#/components/schemas/PublicUserSummary');
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

    it('returns the documented response envelopes at runtime', async function () {
        var originals = {
            authenticate: authService.authenticate,
            authProfile: authService.profile,
            listUsers: sharingService.listUsers,
            publicThings: sharingService.getAll,
            settings: settingsService.get,
            things: thingService.getAll,
            resolveUser: users.resolveUser
        };
        var user = {
            id: '507f1f77bcf86cd799439011',
            username: 'contract-user',
            displayName: 'Contract User'
        };
        var thing = { _id: '507f1f77bcf86cd799439012' };

        authService.authenticate = async function () { return user; };
        authService.profile = async function () { return Object.assign({ email: 'contract@example.com' }, user); };
        sharingService.listUsers = async function () {
            return [{ username: user.username, displayName: user.displayName }];
        };
        sharingService.getAll = async function () { return [thing]; };
        settingsService.get = async function () { return { title: 'Contract' }; };
        thingService.getAll = async function () { return [thing]; };
        users.resolveUser = async function () { return user; };

        try {
            var app = createApp({ sessionMemory: true, sessionSecret: 'rf-708-secret' });
            var agent = request.agent(app);
            await agent.post('/api/login').send({ username: user.username, password: 'password' }).expect(200);

            var profileResponse = await agent.get('/api/profile').expect(200);
            expect(profileResponse.body).to.eql({
                user: Object.assign({ email: 'contract@example.com' }, user)
            });

            var usersResponse = await request(app).get('/api/users').expect(200);
            expect(usersResponse.body).to.eql({
                users: [{ username: user.username, displayName: user.displayName }]
            });

            var userResponse = await request(app).get('/api/users/' + user.id).expect(200);
            expect(userResponse.body).to.eql({ user: user });

            var settingsResponse = await agent.get('/api/settings').expect(200);
            expect(settingsResponse.body).to.eql({ settings: { title: 'Contract' } });

            var thingsResponse = await agent.get('/api/things').expect(200);
            expect(thingsResponse.body).to.eql({ things: [thing] });

            var publicThingsResponse = await request(app).get('/api/public/' + user.id + '/things').expect(200);
            expect(publicThingsResponse.body).to.eql({ things: [thing] });
        } finally {
            authService.authenticate = originals.authenticate;
            authService.profile = originals.authProfile;
            sharingService.listUsers = originals.listUsers;
            sharingService.getAll = originals.publicThings;
            settingsService.get = originals.settings;
            thingService.getAll = originals.things;
            users.resolveUser = originals.resolveUser;
        }
    });
});
