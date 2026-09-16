'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Feature Parity: Attachments, Settings, Import & Export (RF-505)', function () {
    var webDir = path.resolve(__dirname, '../../web');

    it('implements useSettings composable in web/src/composables/useSettings.ts', function () {
        var filePath = path.join(webDir, 'src/composables/useSettings.ts');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('export function useSettings');
        expect(src).to.contain('export interface AppSettings');
        expect(src).to.contain('wide?: boolean');
        expect(src).to.contain('wideNavbar?: boolean');
        expect(src).to.contain('publicBackground?: boolean');
        expect(src).to.contain('showTagSidebar?: boolean');
        expect(src).to.contain('keepPositionAfterEdit?: boolean');
        expect(src).to.contain('backgroundImageDataUrl?: string');
        expect(src).to.contain('loadSettings');
        expect(src).to.contain('saveSettings');
    });

    it('provides upload progress and transfer methods in web/src/api/client.ts', function () {
        var filePath = path.join(webDir, 'src/api/client.ts');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('transfer:');
        expect(src).to.contain('importArchive:');
        expect(src).to.contain('exportUrl:');
        expect(src).to.contain('onProgress');
        expect(src).to.contain('/api/files');
        expect(src).to.contain('/api/import');
    });

    it('implements SettingsModal in web/src/components/SettingsModal.vue', function () {
        var filePath = path.join(webDir, 'src/components/SettingsModal.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('settings-title');
        expect(src).to.contain('Application Title');
        expect(src).to.contain('Wide notes container');
        expect(src).to.contain('Wide navigation toolbar');
        expect(src).to.contain('Custom Background Image');
        expect(src).to.contain('image-picker-box');
        expect(src).to.contain('handleSave');
    });

    it('implements ImportModal in web/src/components/ImportModal.vue', function () {
        var filePath = path.join(webDir, 'src/components/ImportModal.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('import-title');
        expect(src).to.contain('drop-zone');
        expect(src).to.contain('progress-bar');
        expect(src).to.contain('executeImport');
        expect(src).to.contain('api.transfer.importArchive');
        expect(src).to.contain('success-banner');
    });

    it('implements CheatsheetModal in web/src/components/CheatsheetModal.vue', function () {
        var filePath = path.join(webDir, 'src/components/CheatsheetModal.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('cheatsheet-title');
        expect(src).to.contain('Keyboard Shortcuts');
        expect(src).to.contain('Markdown Syntax');
        expect(src).to.contain('Ctrl');
    });

    it('supports drag-and-drop and attachment upload in web/src/components/NoteComposer.vue', function () {
        var filePath = path.join(webDir, 'src/components/NoteComposer.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('handleDrop');
        expect(src).to.contain('handlePaste');
        expect(src).to.contain('uploadFiles');
        expect(src).to.contain('upload-progress-box');
        expect(src).to.contain('composer-attachments');
        expect(src).to.contain('removeAttachment');
        expect(src).to.contain('api.files.upload');
    });

    it('integrates settings, import, export, and cheatsheet in web/src/App.vue', function () {
        var filePath = path.join(webDir, 'src/App.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('SettingsModal');
        expect(src).to.contain('ImportModal');
        expect(src).to.contain('CheatsheetModal');
        expect(src).to.contain('openSettings');
        expect(src).to.contain('openImport');
        expect(src).to.contain('openCheatsheet');
        expect(src).to.contain('/api/export');
        expect(src).to.contain('is-wide');
    });

    it('adapts NotesView to wide layout and import events', function () {
        var filePath = path.join(webDir, 'src/views/NotesView.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('is-wide');
        expect(src).to.contain('meemo:imported');
        expect(src).to.contain('handleImportEvent');
    });

    it('bundles Vue 3 feature parity components into web/dist without errors', function () {
        expect(fs.existsSync(path.join(webDir, 'dist/index.html'))).to.be(true);
        var distIndex = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
        expect(distIndex).to.contain('<div id="app"></div>');
    });
});
