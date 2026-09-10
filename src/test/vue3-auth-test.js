'use strict';

/* global it:false */
/* global describe:false */

var fs = require('fs'),
    path = require('path'),
    expect = require('expect.js');

describe('Vue 3 Auth Shell & Session Handling (RF-502)', function () {
    var webDir = path.resolve(__dirname, '../../web');

    it('implements useAuth composable in web/src/composables/useAuth.ts', function () {
        var filePath = path.join(webDir, 'src/composables/useAuth.ts');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('export function useAuth');
        expect(src).to.contain('export interface RegisterPayload');
        expect(src).to.contain('const user = ref<UserProfile | null>');
        expect(src).to.contain('const isLoading = ref(false)');
        expect(src).to.contain('const authError = ref<string | null>');
        expect(src).to.contain('const sessionExpired = ref(false)');
        expect(src).to.contain('const isFirstUser = ref(false)');
        expect(src).to.contain('const isAuthenticated = computed(');
        expect(src).to.contain('const displayName = computed(');
        expect(src).to.contain('async function init(');
        expect(src).to.contain('async function login(');
        expect(src).to.contain('async function register(');
        expect(src).to.contain('async function logout(');
        expect(src).to.contain('async function checkFirstUser(');
        expect(src).to.contain('function dismissSessionExpired(');
        expect(src).to.contain('onUnauthorized(');
    });

    it('implements 401 interception and event dispatching in web/src/api/client.ts', function () {
        var filePath = path.join(webDir, 'src/api/client.ts');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('export type UnauthorizedHandler');
        expect(src).to.contain('export function onUnauthorized(');
        expect(src).to.contain('function notifyUnauthorized(');
        expect(src).to.contain('response.status === 401');
    });

    it('implements LoginModal component in web/src/components/LoginModal.vue', function () {
        var filePath = path.join(webDir, 'src/components/LoginModal.vue');
        expect(fs.existsSync(filePath)).to.be(true);

        var src = fs.readFileSync(filePath, 'utf8');
        expect(src).to.contain('isFirstUser');
        expect(src).to.contain('activeTab');
        expect(src).to.contain('handleLogin');
        expect(src).to.contain('handleRegister');
        expect(src).to.contain('switchTab');
        expect(src).to.contain('login-username');
        expect(src).to.contain('login-password');
        expect(src).to.contain('reg-username');
        expect(src).to.contain('reg-email');
        expect(src).to.contain('reg-displayName');
        expect(src).to.contain('reg-password');
        expect(src).to.contain('first-user-banner');
    });

    it('integrates profile dropdown and session expired banner in web/src/App.vue', function () {
        var filePath = path.join(webDir, 'src/App.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('session-expired-banner');
        expect(src).to.contain('dismissSessionExpired');
        expect(src).to.contain('user-profile-btn');
        expect(src).to.contain('user-dropdown-menu');
        expect(src).to.contain('userAvatarInitial');
        expect(src).to.contain('openAuthModal');
        expect(src).to.contain('provide(\'openAuthModal\'');
        expect(src).to.contain('LoginModal');
    });

    it('adapts NotesView for authenticated and unauthenticated states in web/src/views/NotesView.vue', function () {
        var filePath = path.join(webDir, 'src/views/NotesView.vue');
        var src = fs.readFileSync(filePath, 'utf8');

        expect(src).to.contain('useAuth');
        expect(src).to.contain('isAuthenticated');
        expect(src).to.contain('isFirstUser');
        expect(src).to.contain('first-user-hero');
        expect(src).to.contain('login-hero');
        expect(src).to.contain('triggerAuthModal');
    });

    it('bundles Vue 3 auth components into web/dist without errors', function () {
        expect(fs.existsSync(path.join(webDir, 'dist/index.html'))).to.be(true);
        var distIndex = fs.readFileSync(path.join(webDir, 'dist/index.html'), 'utf8');
        expect(distIndex).to.contain('<div id="app"></div>');
    });
});
