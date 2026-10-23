'use strict';

var assert = require('assert'),
    MarkdownIt = require('markdown-it'),
    things = require('../database/things.js'),
    ssrf = require('../ssrf.js'),
    service = require('../services/thing-service.js');

describe('Thing service avoids redundant work', function () {
    var originalAdd, originalGet, originalPut, originalEnrich, originalRender;
    var renders, enrichedUrls;
    var content = 'See https://example.com/#fragment and #Work';

    beforeEach(function () {
        originalAdd = things.add;
        originalGet = things.get;
        originalPut = things.put;
        originalEnrich = ssrf.enrichUrls;
        originalRender = MarkdownIt.prototype.render;
        renders = 0;
        enrichedUrls = [];
        MarkdownIt.prototype.render = function () {
            renders++;
            return originalRender.apply(this, arguments);
        };
        ssrf.enrichUrls = async function (urls) {
            enrichedUrls = urls;
            return urls.map(function (url) { return { url: url, type: 'unknown' }; });
        };
    });

    afterEach(function () {
        things.add = originalAdd;
        things.get = originalGet;
        things.put = originalPut;
        ssrf.enrichUrls = originalEnrich;
        MarkdownIt.prototype.render = originalRender;
    });

    it('creates a rich note with one URL parse and no read-back', async function () {
        things.get = function () { throw new Error('redundant read'); };
        things.add = async function (userId, body, tags, attachments, externalContent, color) {
            return { _id: 'note', ownerId: userId, content: body, tags: tags,
                attachments: attachments, externalContent: externalContent, color: color, revision: 1 };
        };
        var result = await service.add('owner', content, [], 'mint');
        assert.deepStrictEqual(enrichedUrls, ['https://example.com/#fragment']);
        assert.deepStrictEqual(result.tags, ['work']);
        assert.strictEqual(renders, 2); // URL parser + tag parser, not two URL parses.
        assert.strictEqual(result.color, 'mint');
        assert.strictEqual(result.revision, 1);
        assert(result.richContent.includes('[#work](#search?#work)'));
        assert.deepStrictEqual(result.attachments, []);
    });

    it('updates with one URL parse while preserving revision and metadata arguments', async function () {
        var received;
        things.put = async function () { received = Array.from(arguments); return { revision: 8 }; };
        var result = await service.put('owner', 'note', content, [], true, false, true, false, 'mint', 7);
        assert.strictEqual(renders, 2);
        assert.deepStrictEqual(enrichedUrls, ['https://example.com/#fragment']);
        assert.deepStrictEqual(received.slice(0, 5), ['owner', 'note', content, ['work'], []]);
        assert.deepStrictEqual(received.slice(6), [true, false, true, false, 'mint', 7, undefined]);
        assert.deepStrictEqual(result, { revision: 8 });
    });

    it('keeps tag extraction equivalent when URLs are precomputed', function () {
        ['', '#中文 #Work', content, 'https://example.com/#anchor', '#one #one'].forEach(function (body) {
            assert.deepStrictEqual(service.extractTags(body, service.extractURLs(body)), service.extractTags(body));
        });
    });
});
