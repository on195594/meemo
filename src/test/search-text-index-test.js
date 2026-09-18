/* jslint node:true */

'use strict';

var expect = require('expect.js'),
    MongoClient = require('mongodb').MongoClient,
    supertest = require('supertest'),
    config = require('../config.js'),
    databaseThings = require('../database/things.js'),
    search = require('../services/search-service.js'),
    thingService = require('../services/thing-service.js'),
    migrator = require('../../scripts/migrate-data-to-v2.js'),
    appModule = require('../../app.js');

describe('MongoDB $text Full-Text Index and Search (Task 3)', function () {
    var dbClient;
    var db;
    var app;
    var testUserA = 'search-text-user-a-' + Date.now();
    var testUserB = 'search-text-user-b-' + Date.now();

    before(async function () {
        dbClient = await MongoClient.connect(config.databaseUrl);
        db = dbClient.db();
        config.db = db;

        await databaseThings.ensureIndexes();
        app = appModule.createApp();
    });

    after(async function () {
        if (db) {
            await db.collection('things').deleteMany({
                ownerId: { $in: [testUserA, testUserB] }
            });
        }
        if (dbClient) {
            await dbClient.close();
        }
        databaseThings.resetCache();
    });

    describe('search-service query building and detection', function () {
        it('detects $text queries correctly across top-level, $and, and $or', function () {
            expect(search.queryHasText({ $text: { $search: 'hello' } })).to.be(true);
            expect(search.queryHasText({
                $and: [{ archived: false }, { $text: { $search: 'hello' } }]
            })).to.be(true);
            expect(search.queryHasText({
                $or: [{ tags: 'work' }, { $text: { $search: 'hello' } }]
            })).to.be(true);
            expect(search.queryHasText({ content: { $regex: 'hello', $options: 'i' } })).to.be(false);
            expect(search.queryHasText(null)).to.be(false);
            expect(search.queryHasText({})).to.be(false);
        });

        it('builds text search filter for plain terms, tags, and mixed queries', function () {
            // Plain keywords
            var filterText = search.buildSearchFilter('benchmark project', 'text');
            expect(filterText).to.eql({ $text: { $search: 'benchmark project' } });

            // Tag only in text mode
            var filterTag = search.buildSearchFilter('#dev', 'text');
            expect(filterTag).to.eql({ tags: 'dev' });

            // Mixed tag and text
            var filterMixed = search.buildSearchFilter('#dev benchmark project', 'text');
            expect(filterMixed).to.eql({
                $and: [
                    { tags: 'dev' },
                    { $text: { $search: 'benchmark project' } }
                ]
            });

            // WikiLink in text mode
            var filterWiki = search.buildSearchFilter('[[Architecture|Arch]]', 'text');
            expect(filterWiki).to.eql({ $text: { $search: 'Architecture' } });

            // Empty or invalid input
            expect(search.buildSearchFilter('', 'text')).to.be(null);
            expect(search.buildSearchFilter('   ', 'text')).to.be(null);
            expect(search.buildSearchFilter(null, 'text')).to.be(null);
        });

        it('preserves regex mode behavior by default', function () {
            var filterDefault = search.buildSearchFilter('benchmark');
            expect(filterDefault).to.have.property('$or');

            var filterExplicitRegex = search.buildSearchFilter('benchmark', 'regex');
            expect(filterExplicitRegex).to.have.property('$or');

            var queryDefault = search.buildQuery({ filter: 'benchmark' });
            expect(search.queryHasText(queryDefault)).to.be(false);

            var queryText = search.buildQuery({ filter: 'benchmark', mode: 'text' });
            expect(search.queryHasText(queryText)).to.be(true);
        });

        it('handles punctuation-only and invalid negation tokens gracefully', function () {
            expect(search.buildSearchFilter('#', 'text')).to.be(null);
            expect(search.buildSearchFilter('###', 'text')).to.be(null);
            expect(search.buildSearchFilter('!!!', 'text')).to.be(null);
            expect(search.buildSearchFilter('-', 'text')).to.be(null);
            expect(search.buildSearchFilter('--', 'text')).to.be(null);
            expect(search.buildSearchFilter('hello !!!', 'text')).to.eql({ $text: { $search: 'hello' } });
            expect(search.buildSearchFilter('-negation hello', 'text')).to.eql({ $text: { $search: '-negation hello' } });
            expect(search.buildSearchFilter('#', 'regex')).to.be(null);
            expect(search.buildSearchFilter('!!!', 'regex')).to.be(null);
        });
    });

    describe('MongoDB $text stemming, scoring, and sorting', function () {
        var noteDocA;
        var noteDocB;
        var noteDocSticky;

        before(async function () {
            // noteDocA: contains word writing (English stemming matches query "writes")
            noteDocA = await thingService.add(testUserA, 'We are writing extensive documentation for search features #docs', []);

            // noteDocB: contains multiple occurrences of benchmark to test higher textScore
            noteDocB = await thingService.add(testUserA, 'The benchmark suite runs benchmark performance benchmark tests', []);

            // noteDocSticky: sticky note with lower keyword density
            var stickyCreated = await thingService.add(testUserA, 'Sticky note mentioning benchmark once', []);
            noteDocSticky = await thingService.put(testUserA, stickyCreated._id, stickyCreated.content, [], false, false, false, true, 'default', stickyCreated.revision);

            // Note belonging to another user to verify owner isolation
            await thingService.add(testUserB, 'benchmark writes note by user b', []);
        });

        it('demonstrates English Porter stemming with $text vs regex failure', async function () {
            // Text mode search for "writes" matches "writing"
            var textQuery = search.buildQuery({ filter: 'writes', mode: 'text' });
            var textResults = await thingService.getAll(testUserA, textQuery, 0, 10);

            expect(textResults.length).to.be.greaterThan(0);
            expect(textResults.some(function (n) { return n._id === noteDocA._id; })).to.be(true);
            expect(textResults[0]).to.have.property('score');
            expect(textResults[0].score).to.be.greaterThan(0);

            // Regex mode search for "writes" does not match "writing"
            var regexQuery = search.buildQuery({ filter: 'writes', mode: 'regex' });
            var regexResults = await thingService.getAll(testUserA, regexQuery, 0, 10);
            expect(regexResults.length).to.be(0);
        });

        it('ranks results by sticky first, then textScore descending', async function () {
            var textQuery = search.buildQuery({ filter: 'benchmark', mode: 'text' });
            var results = await thingService.getAll(testUserA, textQuery, 0, 10);

            expect(results.length).to.be(2);
            // Sticky note appears first despite lower density
            expect(results[0]._id).to.be(noteDocSticky._id);
            expect(results[0].sticky).to.be(true);
            expect(results[0]).to.have.property('score');

            // Non-sticky note appears second with its score
            expect(results[1]._id).to.be(noteDocB._id);
            expect(results[1].sticky).to.be(false);
            expect(results[1]).to.have.property('score');
        });

        it('enforces owner isolation during full-text search', async function () {
            var textQuery = search.buildQuery({ filter: 'benchmark', mode: 'text' });
            var userBResults = await thingService.getAll(testUserB, textQuery, 0, 10);

            expect(userBResults.length).to.be(1);
            expect(userBResults[0].ownerId).to.be(testUserB);
        });

        it('supports mixed tag filter with text search in database layer', async function () {
            var query = search.buildQuery({ filter: '#docs writing', mode: 'text' });
            var results = await thingService.getAll(testUserA, query, 0, 10);

            expect(results.length).to.be(1);
            expect(results[0]._id).to.be(noteDocA._id);
        });

        it('clarifies multi-term search contract: regex requires all terms (AND), text ranks by relevance', async function () {
            // Note containing both words
            var noteBoth = await thingService.add(testUserA, 'multi-term test: alpha bravo together', []);
            // Note containing only alpha
            var noteAlpha = await thingService.add(testUserA, 'multi-term test: only alpha here', []);

            // In regex mode: "alpha bravo" requires both terms
            var regexQuery = search.buildQuery({ filter: 'alpha bravo', mode: 'regex' });
            var regexResults = await thingService.getAll(testUserA, regexQuery, 0, 10);
            expect(regexResults.length).to.be(1);
            expect(regexResults[0]._id).to.be(noteBoth._id);

            // In text mode: "alpha bravo" matches both, but note with both terms has higher relevance score
            var textQuery = search.buildQuery({ filter: 'alpha bravo', mode: 'text' });
            var textResults = await thingService.getAll(testUserA, textQuery, 0, 10);
            expect(textResults.length).to.be(2);
            expect(textResults[0]._id).to.be(noteBoth._id);
            expect(textResults[1]._id).to.be(noteAlpha._id);
            expect(textResults[0].score).to.be.greaterThan(textResults[1].score);

            // In both modes: quoted phrase '"alpha bravo"' requires the continuous phrase
            var quotedRegex = search.buildQuery({ filter: '"alpha bravo"', mode: 'regex' });
            var quotedRegexResults = await thingService.getAll(testUserA, quotedRegex, 0, 10);
            expect(quotedRegexResults.length).to.be(1);
            expect(quotedRegexResults[0]._id).to.be(noteBoth._id);

            var quotedText = search.buildQuery({ filter: '"alpha bravo"', mode: 'text' });
            var quotedTextResults = await thingService.getAll(testUserA, quotedText, 0, 10);
            expect(quotedTextResults.length).to.be(1);
            expect(quotedTextResults[0]._id).to.be(noteBoth._id);
        });

        it('auto-upgrades legacy text index to compound owner_text_content_tags index', async function () {
            var collection = db.collection('things');
            // Drop target index and create legacy index
            await collection.dropIndex('owner_text_content_tags');
            await collection.createIndex({ content: 'text' }, { name: 'content_text', default_language: 'none' });

            var beforeIdxs = await collection.indexes();
            expect(beforeIdxs.some(function (i) { return i.name === 'content_text'; })).to.be(true);
            expect(beforeIdxs.some(function (i) { return i.name === 'owner_text_content_tags'; })).to.be(false);

            // Trigger ensureIndexes - should detect and auto-upgrade
            await databaseThings.ensureIndexes();

            var afterIdxs = await collection.indexes();
            expect(afterIdxs.some(function (i) { return i.name === 'content_text'; })).to.be(false);
            var targetIdx = afterIdxs.find(function (i) { return i.name === 'owner_text_content_tags'; });
            expect(targetIdx).to.be.ok();
            expect(targetIdx.name).to.be('owner_text_content_tags');
            expect(targetIdx.key.ownerId).to.be(1);
            expect(targetIdx.weights).to.eql({ tags: 10, content: 5 });
        });

        it('auto-upgrades text index when existing index has wrong weights', async function () {
            var collection = db.collection('things');
            await collection.dropIndex('owner_text_content_tags');
            // Create index with wrong weights (1 and 1 instead of 10 and 5)
            await collection.createIndex({ ownerId: 1, content: 'text', tags: 'text' }, {
                name: 'owner_text_content_tags',
                weights: { tags: 1, content: 1 }
            });

            var beforeIdx = (await collection.indexes()).find(function (i) { return i.name === 'owner_text_content_tags'; });
            expect(beforeIdx.weights).to.eql({ tags: 1, content: 1 });

            // Trigger ensureIndexes
            await databaseThings.ensureIndexes();

            var afterIdx = (await collection.indexes()).find(function (i) { return i.name === 'owner_text_content_tags'; });
            expect(afterIdx.weights).to.eql({ tags: 10, content: 5 });
        });

        it('handles concurrent ensureIndexes invocations idempotently without IndexNotFound error', async function () {
            var collection = db.collection('things');
            await collection.dropIndex('owner_text_content_tags');
            await collection.createIndex({ content: 'text' }, { name: 'content_text' });

            // Run two ensureIndexes concurrently
            await Promise.all([
                databaseThings.ensureIndexes(),
                databaseThings.ensureIndexes()
            ]);

            var afterIdxs = await collection.indexes();
            expect(afterIdxs.some(function (i) { return i.name === 'content_text'; })).to.be(false);
            var targetIdx = afterIdxs.find(function (i) { return i.name === 'owner_text_content_tags'; });
            expect(targetIdx).to.be.ok();
            expect(targetIdx.weights).to.eql({ tags: 10, content: 5 });
        });
    });

    describe('HTTP GET /api/things?mode=text integration', function () {
        var agent;
        var httpUserId;

        before(async function () {
            agent = supertest.agent(app);
            await agent.post('/api/register')
                .send({
                    username: 'textsearchuser',
                    password: 'Password123!',
                    email: 'textsearch@example.com',
                    displayName: 'Text Search'
                })
                .expect(201);

            await agent.post('/api/login')
                .send({
                    username: 'textsearchuser',
                    password: 'Password123!'
                })
                .expect(200);

            await agent.post('/api/things')
                .send({ content: 'Writing clean code and documentation #dev' })
                .expect(201);

            await agent.post('/api/things')
                .send({ content: 'Performance benchmark and speed tests #perf' })
                .expect(201);
        });

        it('returns 200 with score and stem-matched note when mode=text', async function () {
            var res = await agent.get('/api/things?filter=writes&mode=text')
                .expect(200);

            expect(res.body).to.have.property('things');
            expect(res.body.things.length).to.be(1);
            expect(res.body.things[0].content).to.contain('Writing clean code');
            expect(res.body.things[0]).to.have.property('score');
            expect(typeof res.body.things[0].score).to.be('number');
        });

        it('returns 200 with 0 notes for stemmed word when mode=regex', async function () {
            var res = await agent.get('/api/things?filter=writes&mode=regex')
                .expect(200);

            expect(res.body.things.length).to.be(0);
        });

        it('defaults to mode=regex when mode query param is omitted', async function () {
            var res = await agent.get('/api/things?filter=writes')
                .expect(200);

            expect(res.body.things.length).to.be(0);
        });

        it('handles punctuation-only query safely without throwing 500', async function () {
            var res = await agent.get('/api/things?filter=%23&mode=text')
                .expect(200);
            expect(res.body).to.have.property('things');
            expect(res.body.things.length).to.be.greaterThan(0);
        });
    });

    describe('Migration plannedOwners resolution without existing Mongo user', function () {
        it('resolves canonical owner from plannedOwners during dry-run when user not in Mongo', function (done) {
            var planned = { newuser: '000000000000000000009999' };
            migrator.resolveCanonicalOwner(db, 'newuser', function (err, canonicalId, username) {
                expect(err).to.be(null);
                expect(canonicalId).to.be('000000000000000000009999');
                expect(username).to.be('newuser');
                done();
            }, 'test-phase', null, planned);
        });

        it('rejects when resolved user ID does not match plannedOwners manifest', async function () {
            var wrongPlanned = { textsearchuser: '000000000000000000008888' };
            await new Promise(function (resolve, reject) {
                migrator.resolveCanonicalOwner(db, 'textsearchuser', function (err) {
                    if (err) {
                        expect(err.message).to.contain('manifest');
                        return resolve();
                    }
                    reject(new Error('Expected manifest mismatch error'));
                }, 'test-phase', null, wrongPlanned);
            });
        });
    });
});
