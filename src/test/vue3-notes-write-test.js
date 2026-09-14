'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Notes Write Path (RF-504)', function () {
    var webDir = path.resolve(__dirname, '../../web');

    it('integrates NoteComposer and write actions in web/src/views/NotesView.vue', function () {
        var filePath = path.join(webDir, 'src/views/NotesView.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('NoteComposer');
        expect(src).to.contain('createNote');
        expect(src).to.contain('updateNote');
        expect(src).to.contain('deleteNote');
        expect(src).to.contain('handleToggleSticky');
        expect(src).to.contain('handleTogglePublic');
        expect(src).to.contain('handleToggleArchive');
        expect(src).to.contain('toast-banner');
    });

    it('hides editing actions on public and shared notes views', function () {
        var publicSrc = fs.readFileSync(path.join(webDir, 'src/views/PublicStreamView.vue'), 'utf8');
        expect(publicSrc).to.contain(':can-edit="false"');

        var sharedSrc = fs.readFileSync(path.join(webDir, 'src/views/SharedNoteView.vue'), 'utf8');
        expect(sharedSrc).to.contain(':can-edit="false"');
    });

    it('bundles Vue 3 notes write path into web/dist without errors', function () {
        expect(fs.existsSync(path.join(webDir, 'dist/index.html'))).to.be(true);
        var distIndex = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
        expect(distIndex).to.contain('<div id="app"></div>');
    });
});
