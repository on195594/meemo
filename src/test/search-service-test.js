'use strict';

/* global describe:false */
/* global it:false */

var expect = require('expect.js'),
    search = require('../services/search-service.js');

describe('Search query policy', function () {
    it('combines archive, text, and sticky filters deterministically', function () {
        expect(search.buildQuery({ filter: 'Roadmap #Work', archived: false, sticky: true })).to.eql({
            $and: [
                { $or: [{ archived: false }, { archived: { $exists: false } }] },
                { $and: [
                    { $or: [{ content: { $regex: 'Roadmap', $options: 'i' } }, { tags: 'roadmap' }] },
                    { tags: 'work' }
                ] },
                { sticky: true }
            ]
        });
    });

    it('selects archived notes without adding empty search or sticky clauses', function () {
        expect(search.buildQuery({ filter: '  ', archived: true, sticky: false })).to.eql({ archived: true });
    });

    it('splits query by multi-delimiters including Chinese punctuation', function () {
        var filter = search.buildSearchFilter('文档，架构；#Dev、计划');
        expect(filter).to.eql({
            $and: [
                { $or: [{ content: { $regex: '文档', $options: 'i' } }, { tags: '文档' }] },
                { $or: [{ content: { $regex: '架构', $options: 'i' } }, { tags: '架构' }] },
                { tags: 'dev' },
                { $or: [{ content: { $regex: '计划', $options: 'i' } }, { tags: '计划' }] }
            ]
        });
    });

    it('strips [[wikilink]] brackets in search filter', function () {
        var filter = search.buildSearchFilter('[[Architecture]]');
        expect(filter).to.eql({
            $or: [
                { content: { $regex: 'Architecture', $options: 'i' } },
                { tags: 'architecture' }
            ]
        });
    });

    it('preserves multi-word wikilink phrases and extracts target from aliased wikilinks', function () {
        var filter = search.buildSearchFilter('[[Hello World]] #dev, [[Target Note|Custom Label]]');
        expect(filter).to.eql({
            $and: [
                { $or: [{ content: { $regex: 'Hello World', $options: 'i' } }, { tags: 'hello world' }] },
                { tags: 'dev' },
                { $or: [{ content: { $regex: 'Target Note', $options: 'i' } }, { tags: 'target note' }] }
            ]
        });
    });
});
