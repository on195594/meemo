'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Frontend Foundation (RF-501)', function () {
    var webDir = path.resolve(__dirname, '../../web');

    it('has standard Vite, TypeScript, and Vue 3 project structure', function () {
        expect(fs.existsSync(path.join(webDir, 'package.json'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'vite.config.ts'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'tsconfig.json'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'index.html'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'src/main.ts'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'src/App.vue'))).to.be(true);

        var pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf8'));
        expect(pkg.dependencies).to.have.property('vue');
        expect(pkg.dependencies).to.have.property('vue-router');
        expect(pkg.dependencies).to.have.property('markdown-it');
        expect(pkg.dependencies).to.have.property('dompurify');
        expect(pkg.devDependencies).to.have.property('vite');
        expect(pkg.devDependencies).to.have.property('typescript');
        expect(pkg.devDependencies).to.have.property('@vitejs/plugin-vue');
    });

    it('configures development proxy for backend API and public streams in vite.config.ts', function () {
        var viteConfig = fs.readFileSync(path.join(webDir, 'vite.config.ts'), 'utf8');
        expect(viteConfig).to.contain('/api');
        expect(viteConfig).to.contain('/public');
        expect(viteConfig).to.contain('changeOrigin: true');
    });

    it('configures Vue Router with single-page and public routes in web/src/router/index.ts', function () {
        var routerSrc = fs.readFileSync(path.join(webDir, 'src/router/index.ts'), 'utf8');
        expect(routerSrc).to.contain("path: '/'");
        expect(routerSrc).to.contain("path: '/public/:userId'");
        expect(routerSrc).to.contain("path: '/shared/:thingId'");
        expect(routerSrc).to.contain("path: '/:pathMatch(.*)*'");
        expect(routerSrc).to.contain('createWebHistory');
    });

    it('implements views for Notes, PublicStream, SharedNote, and NotFound', function () {
        expect(fs.existsSync(path.join(webDir, 'src/views/NotesView.vue'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'src/views/PublicStreamView.vue'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'src/views/SharedNoteView.vue'))).to.be(true);
        expect(fs.existsSync(path.join(webDir, 'src/views/NotFoundView.vue'))).to.be(true);
    });

    it('provides unified Markdown rendering and DOMPurify sanitization in web/src/utils/markdown.ts', function () {
        var markdownSrc = fs.readFileSync(path.join(webDir, 'src/utils/markdown.ts'), 'utf8');
        expect(markdownSrc).to.contain('markdown-it');
        expect(markdownSrc).to.contain('dompurify');
        expect(markdownSrc).to.contain('DOMPurify.sanitize');
        expect(markdownSrc).to.contain('renderMarkdown');
    });

    it('provides typed API client in web/src/api/client.ts', function () {
        var clientSrc = fs.readFileSync(path.join(webDir, 'src/api/client.ts'), 'utf8');
        expect(clientSrc).to.contain('export class ApiError');
        expect(clientSrc).to.contain('auth:');
        expect(clientSrc).to.contain('things:');
        expect(clientSrc).to.contain('files:');
        expect(clientSrc).to.contain('settings:');
        expect(clientSrc).to.contain('public:');
    });

    it('produces valid production build artifacts under web/dist', function () {
        expect(fs.existsSync(path.join(webDir, 'dist/index.html'))).to.be(true);
        var distIndex = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
        expect(distIndex).to.contain('<div id="app"></div>');
        expect(distIndex).to.contain('/assets/');
    });
});
