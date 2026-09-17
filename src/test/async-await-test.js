'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    MongoUserRepository = require('../database/users-mongo.js'),
    asyncHandler = require('../http/middleware/async-handler.js'),
    ssrf = require('../ssrf.js');

describe('Promise-first backend flow (RF-304)', function () {
    it('returns promises from repository and service APIs', async function () {
        var mockDb = {
            collection: function () {
                return {
                    find: function () {
                        return {
                            sort: function () {
                                return {
                                    toArray: function () { return Promise.resolve([]); }
                                };
                            }
                        };
                    },
                    createIndex: function () { return Promise.resolve(); }
                };
            }
        };
        var repositoryResult = new MongoUserRepository(mockDb).list();
        var enrichmentResult = ssrf.enrichUrls([]);
        expect(repositoryResult).to.be.a(Promise);
        expect(enrichmentResult).to.be.a(Promise);
        expect(await repositoryResult).to.eql([]);
        expect(await enrichmentResult).to.eql([]);
    });

    it('forwards rejected async route handlers to Express error middleware', function (done) {
        var expected = new Error('async failure');
        asyncHandler(async function () { throw expected; })({}, {}, function (error) {
            expect(error).to.equal(expected);
            done();
        });
    });
});
