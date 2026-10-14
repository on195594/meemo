<template>
  <div id="meemo-app" :class="{ 'has-custom-bg': !!settings.backgroundImageDataUrl }">
    <a class="skip-link" href="#main-content">Skip to content</a>
    <!-- Session Expiration Alert Banner -->
    <div v-if="sessionExpired" class="session-expired-banner" role="alert">
      <div class="banner-content">
        <span class="banner-icon">⚠️</span>
        <span class="banner-text">Your session has expired. Please log in again to continue.</span>
      </div>
      <div class="banner-actions">
        <button type="button" class="banner-btn primary" @click="openLoginModal('login')">
          Log In
        </button>
        <button type="button" class="banner-btn secondary" @click="dismissSessionExpired">
          Dismiss
        </button>
      </div>
    </div>

    <!-- Main Navigation Header -->
    <header class="app-nav">
      <div class="nav-container">
        <button
          v-if="showSidebar"
          type="button"
          class="header-icon-btn menu-btn"
          aria-label="Main menu"
          title="Main menu"
          :aria-expanded="isMobileNav ? mobileNavOpen : sidebarExpanded"
          @click="toggleSidebar"
        >
          <UiIcon name="menu" />
        </button>
        <router-link to="/" class="brand-logo" title="Meemo Home">
          <img src="/favicon.png" alt="Meemo" class="logo-img" width="28" height="28" />
          <span class="logo-text">{{ settings.title || 'Meemo' }}</span>
        </router-link>

        <!-- Center: Header Global Sticky Search Bar -->
        <div v-if="isAuthenticated" class="header-search-wrapper">
          <div class="header-search-box" :class="{ focused: isSearchFocused }">
            <UiIcon name="search" class="header-search-icon" />
            <input
              ref="headerSearchInputRef"
              v-model="headerSearchQuery"
              type="search"
              class="header-search-input"
              placeholder="Search notes or #tags"
              aria-label="Search notes"
              @focus="isSearchFocused = true"
              @blur="isSearchFocused = false"
              @input="handleHeaderSearchInput"
              @keydown.enter.prevent="handleHeaderSearchSubmit"
              @keydown.esc="handleHeaderSearchClear"
            />
            <button
              v-if="headerSearchQuery"
              type="button"
              class="header-search-clear"
              @click="handleHeaderSearchClear"
              title="Clear search"
              aria-label="Clear search"
            >
              &times;
            </button>
            <span v-else class="header-search-shortcut" title="Press Ctrl+K or / to search">
              <kbd>/</kbd>
            </span>
          </div>
        </div>

        <div class="nav-right">
          <button
            v-if="showSidebar"
            type="button"
            class="header-icon-btn view-toggle-btn"
            :title="viewMode === 'grid' ? 'List view' : 'Grid view'"
            :aria-label="viewMode === 'grid' ? 'List view' : 'Grid view'"
            @click="toggleViewMode"
          >
            <UiIcon :name="viewMode === 'grid' ? 'list' : 'grid'" />
          </button>
          <button
            type="button"
            class="header-icon-btn theme-toggle-btn"
            @click="cycleTheme"
            :title="themeTitle"
            :aria-label="themeTitle"
          >
            <UiIcon :name="themeIcon" />
          </button>

          <div class="nav-auth">
            <!-- Authenticated User Profile Dropdown -->
            <div v-if="isAuthenticated && user" class="user-menu-wrapper">
            <button
              type="button"
              ref="userProfileRef"
              class="user-profile-btn"
              aria-controls="account-options"
              :aria-label="`Account options for ${user.displayName || user.username}`"
              @click="toggleUserMenu"
              :aria-expanded="showUserMenu"
            >
              <span class="user-avatar">{{ userAvatarInitial }}</span>
            </button>

            <nav v-if="showUserMenu" id="account-options" class="user-dropdown-menu" aria-label="Account options" @keydown.esc.stop.prevent="closeUserMenu(true)">
              <div class="dropdown-header">
                <span class="header-name">{{ user.displayName }}</span>
                <span class="header-username">@{{ user.username }}</span>
              </div>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item"
                @click="openSettings"
              >
                Settings
              </button>
              <button
                type="button"
                class="dropdown-item"
                @click="openCheatsheet"
              >
                Cheatsheet
              </button>
              <router-link
                :to="`/public/${user.username}`"
                class="dropdown-item"
                @click="closeUserMenu()"
              >
                Public Feed
              </router-link>
              <a
                :href="`/api/rss/${user.username}`"
                target="_blank"
                rel="noopener"
                class="dropdown-item"
                @click="closeUserMenu()"
              >
                RSS Feed
              </a>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item"
                @click="openImport"
              >
                Import
              </button>
              <a
                href="/api/export"
                class="dropdown-item"
                download="meemo-export.tar"
                @click="closeUserMenu()"
              >
                Export
              </a>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item logout-btn"
                @click="handleLogout"
              >
                Log Out
              </button>
            </nav>
          </div>

          <!-- Unauthenticated Action Buttons -->
          <div v-else class="auth-buttons">
            <button
              v-if="isFirstUser"
              type="button"
              class="btn-auth setup-btn"
              @click="openLoginModal('register')"
            >
              Initial Setup
            </button>
            <button
              v-else
              type="button"
              class="btn-auth login-btn"
              @click="openLoginModal('login')"
            >
              Log In
            </button>
          </div>
        </div>
      </div>
    </div>
  </header>

    <div class="app-body">
      <AppSidebar
        v-if="showSidebar"
        :expanded="sidebarExpanded"
        :mobile-open="mobileNavOpen"
        @close="closeMobileNav"
      />
      <div id="main-content" tabindex="-1">
        <router-view />
      </div>
    </div>

    <!-- Modals -->
    <LoginModal
      v-model="showAuthModal"
      :initial-tab="authModalTab"
      @success="onAuthSuccess"
    />

    <SettingsModal
      v-if="showSettingsModal"
      v-model="showSettingsModal"
    />

    <ImportModal
      v-if="showImportModal"
      v-model="showImportModal"
      @imported="handleImportFinished"
    />

    <CheatsheetModal
      v-if="showCheatsheetModal"
      v-model="showCheatsheetModal"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide, watch, defineAsyncComponent } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuth } from './composables/useAuth';
import { useSettings, type ThemeMode, getStoredTheme, setStoredTheme } from './composables/useSettings';
import LoginModal from './components/LoginModal.vue';
import UiIcon from './components/UiIcon.vue';
import AppSidebar from './components/AppSidebar.vue';

const router = useRouter();
const route = useRoute();


const headerSearchQuery = ref('');
const isSearchFocused = ref(false);
const headerSearchInputRef = ref<HTMLInputElement | null>(null);
let headerSearchTimer: number | null = null;

watch(() => route.query.q, (newVal) => {
  const query = typeof newVal === 'string' ? newVal : '';
  if (headerSearchQuery.value !== query) {
    headerSearchQuery.value = query;
  }
}, { immediate: true });

function handleHeaderSearchInput() {
  if (headerSearchTimer) clearTimeout(headerSearchTimer);
  headerSearchTimer = window.setTimeout(() => {
    executeHeaderSearch();
  }, 300);
}

function handleHeaderSearchSubmit() {
  if (headerSearchTimer) clearTimeout(headerSearchTimer);
  executeHeaderSearch();
}

function executeHeaderSearch() {
  const q = headerSearchQuery.value.trim();
  const query = { ...route.query, q: q || undefined, tag: q ? undefined : route.query.tag };
  if (route.path !== '/') {
    router.push({ path: '/', query });
  } else {
    router.replace({ query });
  }
}

function handleHeaderSearchClear() {
  if (headerSearchTimer) clearTimeout(headerSearchTimer);
  headerSearchQuery.value = '';
  const query = { ...route.query };
  delete query.q;
  router.replace({ query });
  headerSearchInputRef.value?.focus();
}

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function writePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: keep in-memory only */ }
}

// shortcut: layout prefs live in this browser only; move into settings if cross-device sync is wanted.
const sidebarExpanded = ref(readPref('meemo_sidebar_expanded') !== '0');
const mobileNavOpen = ref(false);
const viewMode = ref<'grid' | 'list'>(readPref('meemo_view_mode') === 'list' ? 'list' : 'grid');
provide('viewMode', viewMode);

const mobileQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(max-width: 767px)') : null;
const isMobileNav = ref(!!mobileQuery?.matches);
function syncMobileNav() {
  isMobileNav.value = !!mobileQuery?.matches;
  if (!isMobileNav.value) mobileNavOpen.value = false;
}

const showSidebar = computed(() => isAuthenticated.value && route.path === '/');

function toggleSidebar() {
  if (isMobileNav.value) {
    mobileNavOpen.value = !mobileNavOpen.value;
  } else {
    sidebarExpanded.value = !sidebarExpanded.value;
    writePref('meemo_sidebar_expanded', sidebarExpanded.value ? '1' : '0');
  }
}

function closeMobileNav() {
  mobileNavOpen.value = false;
}

function toggleViewMode() {
  viewMode.value = viewMode.value === 'grid' ? 'list' : 'grid';
  writePref('meemo_view_mode', viewMode.value);
}

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && mobileNavOpen.value) {
    closeMobileNav();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    headerSearchInputRef.value?.focus();
    headerSearchInputRef.value?.select();
  } else if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
    e.preventDefault();
    headerSearchInputRef.value?.focus();
    headerSearchInputRef.value?.select();
  }
}

const SettingsModal = defineAsyncComponent(() => import('./components/SettingsModal.vue'));
const ImportModal = defineAsyncComponent(() => import('./components/ImportModal.vue'));
const CheatsheetModal = defineAsyncComponent(() => import('./components/CheatsheetModal.vue'));

const {
  user,
  isAuthenticated,
  sessionExpired,
  isFirstUser,
  init,
  logout,
  dismissSessionExpired,
} = useAuth();

const { settings, loadSettings, saveSettings } = useSettings();

const currentTheme = ref<ThemeMode>(getStoredTheme());

watch(() => settings.value.theme, (newTheme) => {
  if (newTheme && newTheme !== currentTheme.value) {
    currentTheme.value = newTheme;
    setStoredTheme(newTheme);
  }
});

const themeIcon = computed(() => currentTheme.value === 'dark' ? 'moon' : currentTheme.value === 'light' ? 'sun' : 'system');

const themeTitle = computed(() => {
  if (currentTheme.value === 'dark') return 'Theme: Dark (click to switch to Light)';
  if (currentTheme.value === 'light') return 'Theme: Light (click to switch to Auto)';
  return 'Theme: Auto (click to switch to Dark)';
});

const THEME_CYCLE: Record<ThemeMode, ThemeMode> = {
  auto: 'dark',
  dark: 'light',
  light: 'auto',
};

function cycleTheme() {
  const nextTheme = THEME_CYCLE[currentTheme.value] || 'dark';
  currentTheme.value = nextTheme;
  setStoredTheme(nextTheme);
  if (isAuthenticated.value) {
    saveSettings({ theme: nextTheme });
  }
}

const showAuthModal = ref(false);
const authModalTab = ref<'login' | 'register'>('login');
const showUserMenu = ref(false);
const userProfileRef = ref<HTMLButtonElement | null>(null);

const showSettingsModal = ref(false);
const showImportModal = ref(false);
const showCheatsheetModal = ref(false);

function openLoginModal(tab: 'login' | 'register' = 'login') {
  authModalTab.value = isFirstUser.value ? 'register' : tab;
  showAuthModal.value = true;
  showUserMenu.value = false;
}

function openSettings() {
  closeUserMenu();
  showSettingsModal.value = true;
}

function openImport() {
  closeUserMenu();
  showImportModal.value = true;
}

function openCheatsheet() {
  closeUserMenu();
  showCheatsheetModal.value = true;
}

const userAvatarInitial = computed(() => {
  if (!user.value) return '?';
  const name = user.value.displayName || user.value.username;
  return name ? name.charAt(0).toUpperCase() : '?';
});

provide('openAuthModal', openLoginModal);
provide('openSettingsModal', openSettings);
provide('openImportModal', openImport);
provide('openCheatsheetModal', openCheatsheet);

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value;
}

function closeUserMenu(returnFocus = false) {
  showUserMenu.value = false;
  if (returnFocus) userProfileRef.value?.focus();
}

function onAuthSuccess() {
  showAuthModal.value = false;
  showUserMenu.value = false;
  loadSettings();
}

function handleImportFinished() {
  showImportModal.value = false;
  // Trigger a full reload or page event to refresh notes
  window.dispatchEvent(new CustomEvent('meemo:imported'));
}

async function handleLogout() {
  closeUserMenu();
  await logout();
}

function handleGlobalClick(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target?.closest('.user-menu-wrapper')) {
    showUserMenu.value = false;
  }
}

watch(isAuthenticated, (authed) => {
  if (authed) {
    loadSettings();
  }
});

onMounted(() => {
  init();
  if (isAuthenticated.value || (typeof localStorage !== 'undefined' && localStorage.getItem('meemo_has_session') === '1')) {
    loadSettings();
  }
  document.addEventListener('click', handleGlobalClick);
  window.addEventListener('keydown', handleGlobalKeydown);
  mobileQuery?.addEventListener('change', syncMobileNav);

});

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  window.removeEventListener('keydown', handleGlobalKeydown);
  mobileQuery?.removeEventListener('change', syncMobileNav);
  if (headerSearchTimer) clearTimeout(headerSearchTimer);
});
</script>

<style>
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

button,
input,
textarea,
select {
  font: inherit;
}

:where(a, button, input, textarea, select, [tabindex]):focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 3px;
}

::selection {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

input,
textarea {
  caret-color: var(--md-sys-color-primary);
}

.skip-link {
  position: fixed;
  top: 0.5rem;
  left: 0.5rem;
  z-index: 2000;
  transform: translateY(-150%);
  padding: 0.75rem 1rem;
  border-radius: var(--md-sys-shape-corner-sm);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.skip-link:focus {
  transform: translateY(0);
}

img,
video {
  max-width: 100%;
  height: auto;
}

.session-expired-banner {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  padding: 0.75rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
  font-size: var(--md-sys-typescale-body-medium);
}

.banner-content,
.banner-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.banner-btn {
  min-height: 44px;
  padding: 0.5rem 1rem;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.banner-btn.primary {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.banner-btn.secondary {
  background: transparent;
  color: inherit;
}

.banner-btn.secondary:hover {
  background: var(--md-sys-state-hover);
}

.app-nav {
  background-color: var(--md-sys-color-surface);
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  position: sticky;
  top: 0;
  z-index: 100;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

#meemo-app.has-custom-bg .app-nav {
  background-color: rgba(255, 255, 255, 0.94);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

:root[data-theme="dark"] #meemo-app.has-custom-bg .app-nav {
  background-color: rgba(32, 33, 36, 0.94);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) #meemo-app.has-custom-bg .app-nav {
    background-color: rgba(32, 33, 36, 0.94);
  }
}

.nav-container {
  height: 64px;
  padding: 8px 16px 8px 12px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.header-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.header-icon-btn .ui-icon {
  width: 24px;
  height: 24px;
}

.header-icon-btn:hover {
  background-color: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

.header-icon-btn:active {
  background-color: var(--md-sys-state-pressed);
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
  padding-right: 32px;
  min-width: 0;
  flex-shrink: 0;
  max-width: 260px;
  text-decoration: none;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-title-large);
  font-weight: 400;
  letter-spacing: 0;
}

.logo-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logo-img {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  padding: 4px;
}

.nav-auth {
  display: flex;
  align-items: center;
}

.btn-auth {
  min-height: 40px;
  padding: 0.5rem 1.5rem;
  border-radius: var(--md-sys-shape-corner-sm);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: box-shadow var(--md-sys-motion-duration-short) ease;
}

.btn-auth:hover {
  box-shadow: var(--keep-shadow-hover);
}

.user-menu-wrapper {
  position: relative;
  margin-left: 8px;
}

.user-profile-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  background: none;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.user-profile-btn:hover,
.user-profile-btn[aria-expanded="true"] {
  background-color: var(--md-sys-state-hover);
}

.user-avatar {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-title-small);
  font-weight: 500;
}

.user-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  width: min(248px, calc(100vw - 2rem));
  background-color: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-md);
  box-shadow: var(--md-sys-elevation-2);
  padding: 0.5rem 0;
  display: flex;
  flex-direction: column;
  z-index: 101;
  transform-origin: top right;
  animation: menu-in var(--md-sys-motion-duration-short) var(--md-sys-motion-easing);
}

@keyframes menu-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(-4px);
  }
}

.dropdown-header {
  padding: 0.5rem 1rem;
  display: flex;
  flex-direction: column;
}

.header-name {
  overflow-wrap: anywhere;
  font-weight: 500;
  font-size: var(--md-sys-typescale-title-small);
  color: var(--md-sys-color-on-surface);
}

.header-username {
  overflow-wrap: anywhere;
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.dropdown-divider {
  border: none;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  margin: 0.5rem 0;
}

.dropdown-item {
  display: block;
  min-height: 44px;
  padding: 0.625rem 1rem;
  font-size: var(--md-sys-typescale-label-large);
  color: var(--md-sys-color-on-surface);
  text-decoration: none;
  text-align: left;
  background: none;
  border: none;
  width: 100%;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.dropdown-item:hover {
  background-color: var(--md-sys-state-hover);
}

.dropdown-item:active {
  background-color: var(--md-sys-state-pressed);
}

.dropdown-item.logout-btn {
  color: var(--md-sys-color-error);
}

.dropdown-item.logout-btn:hover {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

/* Header layout & search bar styles */
.nav-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
  padding-left: 16px;
}

.header-search-wrapper {
  flex: 1;
  min-width: 0;
  max-width: 720px;
}

.header-search-box {
  position: relative;
  display: flex;
  align-items: center;
  height: 48px;
  background-color: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-sm);
  padding: 0 4px 0 4px;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.header-search-box.focused {
  background-color: var(--md-sys-color-surface-container);
  box-shadow: var(--keep-shadow-hover);
}

:root[data-theme="dark"] .header-search-box.focused {
  background-color: #f1f3f4;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .header-search-box.focused {
    background-color: #f1f3f4;
  }
}

.header-search-icon {
  width: 48px;
  height: 24px;
  padding: 0 12px;
  color: var(--md-sys-color-on-surface-variant);
  flex-shrink: 0;
}

.header-search-input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  font-size: var(--md-sys-typescale-body-large);
  color: var(--md-sys-color-on-surface);
}

/* Dark mode: the focused box turns light, so its text must turn dark */
:root[data-theme="dark"] .header-search-box.focused :is(.header-search-input, .header-search-icon, .header-search-clear) {
  color: #202124;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .header-search-box.focused :is(.header-search-input, .header-search-icon, .header-search-clear) {
    color: #202124;
  }
}

.header-search-input::-webkit-search-cancel-button {
  display: none;
}

.header-search-input:focus-visible {
  outline: none;
}

.header-search-input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.header-search-clear {
  background: transparent;
  border: none;
  color: var(--md-sys-color-on-surface-variant);
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  font-size: 1.5rem;
  line-height: 1;
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-full);
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.header-search-clear:hover {
  background: var(--md-sys-state-hover);
}

.header-search-shortcut {
  flex-shrink: 0;
  margin: 0 0.75rem;
  pointer-events: none;
  display: inline-flex;
}

.header-search-shortcut kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  height: 1.5rem;
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  font-family: var(--md-sys-typescale-font-mono);
  font-size: var(--md-sys-typescale-label-medium);
  line-height: 1;
  padding: 0 0.375rem;
  border-radius: var(--md-sys-shape-corner-xs);
}

.app-body {
  display: flex;
  align-items: flex-start;
}

#main-content {
  flex: 1;
  min-width: 0;
}

#main-content:focus {
  outline: none;
}

@media (max-width: 767px) {
  .nav-container {
    padding: 8px;
    gap: 0;
  }

  .brand-logo {
    padding-right: 8px;
  }

  .logo-text,
  .header-search-shortcut,
  .view-toggle-btn {
    display: none;
  }

  .nav-right {
    padding-left: 4px;
    gap: 0;
  }

  .brand-logo:has(+ .header-search-wrapper) {
    display: none;
  }

  .header-search-wrapper {
    margin-left: 4px;
  }

  .header-search-input {
    font-size: 1rem;
  }

  .user-menu-wrapper {
    margin-left: 0;
  }
}
</style>
