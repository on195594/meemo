'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Notes Read Path (RF-503)', function () {
    var webDir = path.resolve(__dirname, '../../web');


    it('implements NoteCard component in web/src/components/NoteCard.vue', function () {
        var filePath = path.join(webDir, 'src/components/NoteCard.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('thing.sticky');
        expect(src).to.contain('thing.public');
        expect(src).to.contain('thing.shared');
        expect(src).to.contain('thing.archived');
        expect(src).to.contain('badge-sticky');
        expect(src).to.contain('badge-public');
        expect(src).to.contain('badge-archived');
        expect(src).to.contain('renderMarkdown');
        expect(src).to.contain('thing.attachments');
        expect(src).to.contain('tagClick');
        expect(src).to.contain('tag-pill');
    });

    it('implements TagSidebar component in web/src/components/TagSidebar.vue', function () {
        var filePath = path.join(webDir, 'src/components/TagSidebar.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('sidebar-title');
        expect(src).to.contain('tag-item');
        expect(src).to.contain('tag-count');
        expect(src).to.contain('selectTag');
        expect(src).to.contain('clearTag');
    });

    it('integrates search, archive toggle, and stream layout in web/src/views/NotesView.vue', function () {
        var filePath = path.join(webDir, 'src/views/NotesView.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('useNotes');
        expect(src).to.contain('NoteCard');
        expect(src).to.contain('TagSidebar');
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
