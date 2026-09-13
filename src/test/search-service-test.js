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

    it('benchmarks deterministic fixtures with execution stats', function () {
        var benchmark = require('../../scripts/benchmark-search.js');
        var matcher = benchmark.compile(search.buildQuery({ filter: 'benchmark #work', archived: false }));
        var result = benchmark.benchmark(100, 1, 2, matcher);

        expect(result.fixtureSize).to.equal(100);
        expect(result.executionStats.documentsExaminedPerRun).to.equal(100);
        expect(result.executionStats.documentsMatchedPerRun).to.equal(5);
        expect(result.executionStats.totalDocumentsExamined).to.equal(200);
        expect(result.p50Ms).to.be.a('number');
        expect(result.p95Ms).to.be.a('number');
        expect(result.avgMs).to.be.a('number');
    });
});
