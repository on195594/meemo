'use strict';

/* global it:false */
/* global describe:false */

var expect = require('expect.js'),
    logic = require('../services/thing-service.js');

describe('Things', function () {
    describe('extractURLs',  function () {
        it('succeeds with one url', function () {
            var test = 'Some content with a url https://example.com/';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(1);
            expect(urls[0]).to.equal('https://example.com/');
        });

        it('succeeds with multiple urls on one line', function () {
            var test = 'Some content with a url https://example.com/ and https://example.com/timestwo with even more https://example.com/cheerio.html bar';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(3);
            expect(urls[0]).to.equal('https://example.com/');
            expect(urls[1]).to.equal('https://example.com/timestwo');
            expect(urls[2]).to.equal('https://example.com/cheerio.html');
        });

        it('succeeds with multiple urls on multiple lines', function () {
            var test = 'Some content with a url https://example.com/ and https://example.com/timestwo with \n even more https://example.com/cheerio.html bar';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(3);
            expect(urls[0]).to.equal('https://example.com/');
            expect(urls[1]).to.equal('https://example.com/timestwo');
            expect(urls[2]).to.equal('https://example.com/cheerio.html');
        });

        it('filters out duplicate links', function () {
            var test = 'Some content with a url https://example.com/cheerio.html and https://example.com/timestwo with \n even more https://example.com/cheerio.html bar';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(2);
            expect(urls[0]).to.equal('https://example.com/cheerio.html');
            expect(urls[1]).to.equal('https://example.com/timestwo');
        });

        it('succeeds with multiple urls and #', function () {
            var test = 'Some content with a url https://example.com/#/ and https://example.com/time#stwo with even more https://example.com/cheerio.html#11 https://example.com/cheerio.html#11/give_me_more bar';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(4);
            expect(urls[0]).to.equal('https://example.com/#/');
            expect(urls[1]).to.equal('https://example.com/time#stwo');
            expect(urls[2]).to.equal('https://example.com/cheerio.html#11');
            expect(urls[3]).to.equal('https://example.com/cheerio.html#11/give_me_more');
        });

        it('does not extract urls from inline code blocks', function () {
            var test = 'Some code `content with a url https://example.com/` end';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(0);
        });

        it('does not extract urls from code blocks', function () {
            var test = 'Some code \n ```content with a url https://example.com/``` \n end';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(0);
        });

        it('does not extract markdown links', function () {
            var test = 'Test https://example.com/#/ spacer [Emphasis](#Emphasis) foobar [some link](https://example.com/#/)';

            var urls = logic.extractURLs(test);
            expect(urls.length).to.equal(1);
        });
    });

    describe('extractTags',  function () {
        it('succeeds with one tag', function () {
            var test = 'Hello #tag there!';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(1);
            expect(tags[0]).to.equal('tag');
        });

        it('succeeds with an umlaut tag', function () {
            var test = 'Kochen in der #küche!';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(1);
            expect(tags[0]).to.equal('küche');
        });

        it('succeeds with Chinese tags', function () {
            var test = '这是工作笔记 #工作 #学习_重点 #深度学习 结束';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(3);
            expect(tags[0]).to.equal('工作');
            expect(tags[1]).to.equal('学习_重点');
            expect(tags[2]).to.equal('深度学习');
        });

        it('succeeds with a tag starting with numbers', function () {
            var test = 'Hello #1337tag there!';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(1);
            expect(tags[0]).to.equal('1337tag');
        });

        it('succeeds with multiple tags', function () {
            var test = 'Hello #tag there! more #foobar #house tags';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(3);
            expect(tags[0]).to.equal('tag');
            expect(tags[1]).to.equal('foobar');
            expect(tags[2]).to.equal('house');
        });

        it('succeeds with multiple tags on multiple lines', function () {
            var test = 'Hello #tag there! more #foobar #house tags \n #other tags in #second line';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(5);
            expect(tags[0]).to.equal('tag');
            expect(tags[1]).to.equal('foobar');
            expect(tags[2]).to.equal('house');
            expect(tags[3]).to.equal('other');
            expect(tags[4]).to.equal('second');
        });

        it('succeeds with multiple tags together', function () {
            var test = 'Hello #tag there! more #foobar#house tags';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(3);
            expect(tags[0]).to.equal('tag');
            expect(tags[1]).to.equal('foobar');
            expect(tags[2]).to.equal('house');
        });

        it('ignores # in urls', function () {
            var test = 'Hello #tag there! more https://example.com/#11/52.5194/13.3456 tags';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(1);
            expect(tags[0]).to.equal('tag');
        });

        it('extract tags from urls ending with a tag in multiple urls', function () {
            var test = 'Hello #tag there! more https://example.com/#11/52.5194/13.3456 tags foo  https://example.com/#11/52.5194/13.3456#bar';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(2);
            expect(tags[0]).to.equal('tag');
            expect(tags[1]).to.equal('bar');
        });

        it('succeeds for tags at the beginning', function () {
            var test = '#nad #and #we #do #this #more #often #so #we #can #produce #a #hell #of #a #lot #schlagworte';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(17);
            expect(tags).to.eql(['nad', 'and', 'we', 'do', 'this', 'more', 'often', 'so', 'we', 'can', 'produce', 'a', 'hell', 'of', 'a', 'lot', 'schlagworte' ]);
        });

        it('succeeds for tags starting with other tags', function () {
            var test = '#nad #and #we #do #this#more #often #so #we #can #produce#a#hell #of #a #lot #schlagworte';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(17);
            expect(tags).to.eql(['nad', 'and', 'we', 'do', 'this', 'more', 'often', 'so', 'we', 'can', 'produce', 'a', 'hell', 'of', 'a', 'lot', 'schlagworte' ]);
        });

        it('does not extract tags from inline code blocks', function () {
            var test = 'Some code `content with a #toggly tag` end';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(0);
        });

        it('does not extract tags from code blocks', function () {
            var test = 'Some code \n ```content with a #taggly tag``` \n end';

            var tags = logic.extractTags(test);
            expect(tags.length).to.equal(0);
        });

        it('keeps tag extraction equivalent when URLs are precomputed', function () {
            var content = 'See https://example.com/#fragment and #Work';
            ['', '#中文 #Work', content, 'https://example.com/#anchor', '#one #one'].forEach(function (body) {
                expect(logic.extractTags(body, logic.extractURLs(body))).to.eql(logic.extractTags(body));
            });
        });
    });

    describe('richContent',  function () {
        var USER_ID = 'testUserId';

        it('shortens long URLs', async function () {
            var longUrl = 'https://example.com/nebulade/status/761263459120115716/761263459120115716/761263459120115716/?bar=bazhashsometihg=foo#more=so';
            var content = 'Hello this is a too long url ' + longUrl + ' yeah';
            var thing = {
                tags: logic.extractTags(content),
                externalContent: [{ type: logic.TYPE_UNKNOWN, url: longUrl }],
                attachments: [],
                content: content,
            };
            var result = await logic.facelift(USER_ID, thing);
            expect(result).to.equal('Hello this is a too long url [example.com/nebulade/status/761263459120...](' + longUrl + ') yeah');
        });

        it('succeeds for tags starting at the beginning', async function () {
            var content = '#nad #and #we #do #this #more #often #So #we #can #produce #a #hell #of #a #lot #schlagworte';
            var thing = {
                tags: logic.extractTags(content),
                externalContent: [],
                attachments: [],
                content: content,
            };
            var result = await logic.facelift(USER_ID, thing);
            expect(result).to.equal('[#nad](#search?#nad) [#and](#search?#and) [#we](#search?#we) [#do](#search?#do) [#this](#search?#this) [#more](#search?#more) [#often](#search?#often) [#so](#search?#so) [#we](#search?#we) [#can](#search?#can) [#produce](#search?#produce) [#a](#search?#a) [#hell](#search?#hell) [#of](#search?#of) [#a](#search?#a) [#lot](#search?#lot) [#schlagworte](#search?#schlagworte)');
        });

        it('succeeds for tags starting with other tags', async function () {
            var content = '#nad #more#often#so #we';
            var thing = {
                tags: logic.extractTags(content),
                externalContent: [],
                attachments: [],
                content: content,
            };
            var result = await logic.facelift(USER_ID, thing);
            expect(result).to.equal('[#nad](#search?#nad) [#more](#search?#more)[#often](#search?#often)[#so](#search?#so) [#we](#search?#we)');
        });

        it('succeeds for attachments with special regex characters in fileName', async function () {
            var fileName = 'file [1] (test) + foo*.png';
            var thing = {
                _id: '507f1f77bcf86cd799439011',
                tags: [],
                externalContent: [],
                attachments: [{
                    fileName: fileName,
                    identifier: 'ident-123.png',
                    type: logic.TYPE_IMAGE
                }],
                content: 'Here is an image: [' + fileName + ']'
            };
            var result = await logic.facelift(USER_ID, thing);
            expect(result).to.contain('![/api/files/' + USER_ID + '/' + thing._id + '/ident-123.png](/api/files/' + USER_ID + '/' + thing._id + '/ident-123.png)');
        });

        it('preserves WikiLink spans without rewriting attachment names or tags inside brackets', async function () {
            var fileName = 'diagram.png';
            var thing = {
                _id: '507f1f77bcf86cd799439011',
                tags: ['work'],
                externalContent: [],
                attachments: [{
                    fileName: fileName,
                    identifier: 'ident-diagram.png',
                    type: logic.TYPE_IMAGE
                }],
                content: 'See [[diagram.png]] and [[Note #work]] alongside [' + fileName + '] and #work'
            };
            var result = await logic.facelift(USER_ID, thing);
            expect(result).to.contain('[[diagram.png]]');
            expect(result).to.contain('[[Note #work]]');
            expect(result).to.contain('![/api/files/' + USER_ID + '/' + thing._id + '/ident-diagram.png]');
            expect(result).to.contain('[#work](#search?#work)');
        });
    });

    describe('HTTP /api/things and shared note routes', function () {
        var MongoClient = require('mongodb').MongoClient;
        var request = require('supertest');
        var config = require('../config.js');
        var users = require('../users.js');
        var createApp = require('../http/app.js');
        var dbClient;
        var previousDb;
        var app;
        var aliceAgent;
        var bobAgent;

        before(async function () {
            previousDb = config.db;
            await config._clearDatabase();
            dbClient = await MongoClient.connect(config.databaseUrl);
            config.db = dbClient.db();
            await users.create('httpalice', 'httpalice@example.com', 'HTTP Alice', 'password123');
            await users.create('httpbob', 'httpbob@example.com', 'HTTP Bob', 'password123');
            app = createApp({ sessionMemory: true, sessionSecret: 'things-http-test-secret' });
            aliceAgent = request.agent(app);
            bobAgent = request.agent(app);
            await aliceAgent.post('/api/login').send({ username: 'httpalice', password: 'password123' }).expect(200);
            await bobAgent.post('/api/login').send({ username: 'httpbob', password: 'password123' }).expect(200);
        });

        after(async function () {
            try {
                await config._clearDatabase();
            } finally {
                if (dbClient) await dbClient.close();
                config.db = previousDb;
            }
        });

        it('isolates GET /api/things/:id across users and rejects malformed ObjectIds', async function () {
            var created = await aliceAgent.post('/api/things').send({ content: 'Alice secret note' }).expect(201);
            var id = created.body.thing._id;

            await aliceAgent.get('/api/things/' + id).expect(200);
            var crossUser = await bobAgent.get('/api/things/' + id).expect(404);
            expect(crossUser.body.code).to.equal('not_found');

            var invalidId = await aliceAgent.get('/api/things/not-an-object-id').expect(400);
            expect(invalidId.body.code).to.equal('invalid_request');
        });

        it('filters GET /api/things by sticky and query string end-to-end', async function () {
            var sticky = await aliceAgent.post('/api/things').send({ content: '置顶计划 #roadmap' }).expect(201);
            await aliceAgent.put('/api/things/' + sticky.body.thing._id).send({
                content: '置顶计划 #roadmap',
                sticky: true,
                expectedRevision: sticky.body.thing.revision
            }).expect(201);
            await aliceAgent.post('/api/things').send({ content: '普通记录 #notes' }).expect(201);

            var stickyList = await aliceAgent.get('/api/things?sticky=true').expect(200);
            expect(stickyList.body.things.map(function (t) { return t._id; })).to.eql([sticky.body.thing._id]);

            var filtered = await aliceAgent.get('/api/things').query({ filter: '置顶 #roadmap' }).expect(200);
            expect(filtered.body.things.map(function (t) { return t._id; })).to.eql([sticky.body.thing._id]);
        });

        it('serves shared notes on GET /api/public/shared/things/:thingId while blocking non-shared notes', async function () {
            var created = await aliceAgent.post('/api/things').send({ content: 'Shared note body' }).expect(201);
            var id = created.body.thing._id;

            await request(app).get('/api/public/shared/things/' + id).expect(403);

            await aliceAgent.put('/api/things/' + id).send({
                content: 'Shared note body',
                shared: true,
                expectedRevision: created.body.thing.revision
            }).expect(201);

            var sharedRes = await request(app).get('/api/public/shared/things/' + id).expect(200);
            expect(sharedRes.body.thing._id).to.equal(id);
            expect(sharedRes.body.thing.content).to.equal('Shared note body');
        });

        it('derives exact owner-isolated tag usage through add, edit/archive, and delete', async function () {
            var first = await logic.add('tag-owner-a', '#same #same', []);
            await logic.add('tag-owner-b', '#same', []);
            expect(await logic.getTags('tag-owner-a')).to.eql([
                { ownerId: 'tag-owner-a', name: 'same', usage: 2 }
            ]);

            var updatedFirst = await logic.put(
                'tag-owner-a', first._id, '#other', [], false, false, true, false, undefined, first.revision
            );
            expect(await logic.getTags('tag-owner-a')).to.eql([
                { ownerId: 'tag-owner-a', name: 'other', usage: 1 }
            ]);
            expect(await logic.getTags('tag-owner-b')).to.eql([
                { ownerId: 'tag-owner-b', name: 'same', usage: 1 }
            ]);

            await logic.del('tag-owner-a', first._id, updatedFirst.revision);
            expect(await logic.getTags('tag-owner-a')).to.eql([]);
        });
    });
});
