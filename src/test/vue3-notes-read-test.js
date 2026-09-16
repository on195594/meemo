'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Notes Read Path (RF-503)', function () {
    var webDir = path.resolve(__dirname, '../../web');

    it('integrates search, archive toggle, and stream layout in web/src/views/NotesView.vue', function () {
        var filePath = path.join(webDir, 'src/views/NotesView.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('useNotes');
        expect(src).to.contain('NoteCard');
        expect(src).to.contain('active-filter-bar');
        expect(src).to.contain('load-more-btn');
        expect(src).to.contain('handleTagClick');
        expect(src).to.contain('handleViewSwitch');
        expect(src).to.contain('IntersectionObserver');
    });

    it('reuses NoteCard component in PublicStreamView and SharedNoteView', function () {
        var publicSrc = fs.readFileSync(path.join(webDir, 'src/views/PublicStreamView.vue'), 'utf8');
        expect(publicSrc).to.contain('NoteCard');
        expect(publicSrc).to.contain(':thing="thing"');

        var sharedSrc = fs.readFileSync(path.join(webDir, 'src/views/SharedNoteView.vue'), 'utf8');
        expect(sharedSrc).to.contain('NoteCard');
        expect(sharedSrc).to.contain(':thing="thing"');
    });

    it('bundles Vue 3 notes read path into web/dist without errors', function () {
        expect(fs.existsSync(path.join(webDir, 'dist/index.html'))).to.be(true);
        var distIndex = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
        expect(distIndex).to.contain('<div id="app"></div>');
    });
});
