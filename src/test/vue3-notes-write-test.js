'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Notes Write Path (RF-504)', function () {
    var webDir = path.resolve(__dirname, '../../web');


    it('implements NoteComposer component in web/src/components/NoteComposer.vue', function () {
        var filePath = path.join(webDir, 'src/components/NoteComposer.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('composer-textarea');
        expect(src).to.contain('Ctrl');
        expect(src).to.contain('Enter');
        expect(src).to.contain('Save Note');
        expect(src).to.contain('handleKeyDown');
        expect(src).to.contain('handleSubmit');
        expect(src).to.contain('onSave');
    });

    it('implements editing, toggles, and delete confirmation in web/src/components/NoteCard.vue', function () {
        var filePath = path.join(webDir, 'src/components/NoteCard.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('card-actions');
        expect(src).to.contain('toggleSticky');
        expect(src).to.contain('togglePublic');
        expect(src).to.contain('toggleArchive');
        expect(src).to.contain('startEdit');
        expect(src).to.contain('cancelEdit');
        expect(src).to.contain('saveEdit');
        expect(src).to.contain('edit-textarea');
        expect(src).to.contain('delete-modal-card');
        expect(src).to.contain('confirmDelete');
        expect(src).to.contain('canEdit');
    });

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
