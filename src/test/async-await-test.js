'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    fs = require('fs'),
    LegacyFileUserRepository = require('../database/users-file.js'),
    asyncHandler = require('../http/middleware/async-handler.js'),
    ssrf = require('../ssrf.js');

describe('Promise-first backend flow (RF-304)', function () {
    it('returns promises from repository and service APIs', async function () {
        var file = '/tmp/meemo-async-repository-' + process.pid + '.json';
        fs.rmSync(file, { force: true });

        try {
            var repositoryResult = new LegacyFileUserRepository(file).list();
            var enrichmentResult = ssrf.enrichUrls([]);
            expect(repositoryResult).to.be.a(Promise);
            expect(enrichmentResult).to.be.a(Promise);
            expect(await repositoryResult).to.eql([]);
            expect(await enrichmentResult).to.eql([]);
        } finally {
            fs.rmSync(file, { force: true });
        }
    });

    it('forwards rejected async route handlers to Express error middleware', function (done) {
        var expected = new Error('async failure');
        asyncHandler(async function () { throw expected; })({}, {}, function (error) {
            expect(error).to.equal(expected);
            done();
        });
    });
});
