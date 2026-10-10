'use strict';

/* global describe:false */
/* global it:false */

var expect = require('expect.js'),
    search = require('../services/search-service.js'),
    things = require('../database/things.js');

describe('Index-friendly query normalization', function () {
    it('collapses the active-archive $or into an equality at any nesting depth', function () {
        var query = search.buildQuery({ filter: 'Roadmap #Work', archived: false });
        var normalized = JSON.stringify(things.normalizeQueryForIndex(query));
        expect(normalized).to.contain('{"archived":false}');
        expect(normalized).not.to.contain('$exists');
    });

    it('preserves unrelated $or clauses such as content/tag search', function () {
        var query = { $or: [{ content: { $regex: 'a', $options: 'i' } }, { tags: 'a' }] };
        expect(things.normalizeQueryForIndex(query)).to.eql(query);
    });

    it('leaves archived-only and deleted queries unchanged', function () {
        expect(things.normalizeQueryForIndex({ archived: true })).to.eql({ archived: true });
        var q = { deletedAt: { $exists: true } };
        expect(things.normalizeQueryForIndex(q)).to.eql(q);
    });
});
