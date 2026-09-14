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

});
