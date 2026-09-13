'use strict';

/* global it:false */
/* global describe:false */
/* global before:false */
/* global after:false */

var expect = require('expect.js');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var config = require('../config.js');
var ssrf = require('../ssrf.js');
var things = require('../database/things.js');
var service = require('../services/thing-service.js');

describe('Read-only thing presentation (VR-203)', function () {
    var client;
    var db;
    var ownerId = 'vr203-owner';
    var thingId;
    var originalEnrichUrls;
    var enrichmentCalls = 0;

    before(async function () {
        await config._clearDatabase();
        client = await MongoClient.connect(config.databaseUrl);
        db = client.db();
        config.db = db;
        things.resetCache();
        originalEnrichUrls = ssrf.enrichUrls;
        ssrf.enrichUrls = function () {
            enrichmentCalls++;
            return Promise.reject(new Error('read attempted network enrichment'));
        };

        thingId = new ObjectId();
        await db.collection('things').insertOne({
            _id: thingId,
            ownerId: ownerId,
            content: 'Missing preview https://example.com/',
            tags: [],
            attachments: [],
            createdAt: 1,
            modifiedAt: 1,
            public: true,
            shared: true,
            archived: true,
            sticky: true
        });
    });

    after(async function () {
        ssrf.enrichUrls = originalEnrichUrls;
        await config._clearDatabase();
        await client.close();
    });

    it('does not enrich or persist defaults during list, single, or public reads', async function () {
        var id = String(thingId);
        var results = [
            (await service.getAll(ownerId, {}, 0, 10))[0],
            await service.get(ownerId, id),
            (await service.getAllPublic(ownerId, {}, 0, 10))[0],
            await service.getPublic(ownerId, id),
            await service.getPublicShared(id)
        ];

        results.forEach(function (result) {
            expect(result.externalContent).to.eql([]);
            expect(result.public).to.be(true);
            expect(result.shared).to.be(true);
            expect(result.archived).to.be(true);
            expect(result.sticky).to.be(true);
        });
        expect(enrichmentCalls).to.equal(0);

        var stored = await db.collection('things').findOne({ _id: thingId });
        expect(Object.prototype.hasOwnProperty.call(stored, 'externalContent')).to.be(false);
        expect(stored.public).to.be(true);
        expect(stored.shared).to.be(true);
        expect(stored.archived).to.be(true);
        expect(stored.sticky).to.be(true);
    });
});