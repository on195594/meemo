'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Frontend Foundation (RF-501)', function () {
    var webDir = path.resolve(__dirname, '../../web');

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
});
