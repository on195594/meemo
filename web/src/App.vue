<template>
  <div id="meemo-app">
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
      <div class="nav-container" :class="{ 'is-wide': settings.wideNavbar }">
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
          <!-- Theme Mode Toggle -->
          <div class="header-theme-toggle">
            <button
              type="button"
              class="header-toggle-btn theme-toggle-btn"
              @click="cycleTheme"
              :title="themeTitle"
              :aria-label="themeTitle"
            >
              <UiIcon :name="themeIcon" />
              <span class="btn-label">{{ themeLabel }}</span>
            </button>
          </div>

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
              <span class="user-name">{{ user.displayName || user.username }}</span>
              <span class="caret-icon">▼</span>
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
                @click="handleToggleArchiveFromMenu"
              >
                {{ isArchived ? 'Active Notes' : 'Archived Notes' }}
              </button>
              <button
                type="button"
                class="dropdown-item"
                @click="handleToggleDeletedFromMenu"
              >
                {{ isDeleted ? 'Active Notes' : 'Trash' }}
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

    <!-- Main View Content -->
    <div id="main-content" tabindex="-1">
      <router-view />
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

const router = useRouter();
const route = useRoute();

const isArchived = computed(() => route.query.archived === '1' || route.query.archived === 'true');
const isDeleted = computed(() => route.query.deleted === '1' || route.query.deleted === 'true');

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

function handleToggleArchiveView() {
  const query = { ...route.query, archived: isArchived.value ? undefined : 'true', deleted: undefined };
  if (route.path !== '/') router.push({ path: '/', query });
  else router.replace({ query });
}

function handleToggleArchiveFromMenu() {
  handleToggleArchiveView();
  closeUserMenu();
}

function handleToggleDeletedFromMenu() {
  const query = { ...route.query, deleted: isDeleted.value ? undefined : 'true', archived: undefined };
  if (route.path !== '/') router.push({ path: '/', query });
  else router.replace({ query });
  closeUserMenu();
}

function handleGlobalKeydown(e: KeyboardEvent) {
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

const themeLabel = computed(() => {
  if (currentTheme.value === 'dark') return 'Dark';
  if (currentTheme.value === 'light') return 'Light';
  return 'Auto';
});

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

});

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  window.removeEventListener('keydown', handleGlobalKeydown);
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

button,
input,
textarea,
select {
  font-family: inherit;
}

:where(button, a, input, textarea, select):focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 3px;
}

body {
  background-color: var(--md-sys-color-surface, #f8fafd);
  color: var(--md-sys-color-on-surface, #1f1f1f);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
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
  font-size: 0.9rem;
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
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.banner-btn.primary {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.banner-btn.secondary {
  background: transparent;
  color: inherit;
}

.banner-btn:hover {
  text-decoration: underline;
}

.app-nav {
  background-color: var(--md-sys-color-surface, #ffffff);
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-container {
  max-width: 1040px;
  margin: 0 auto;
  padding: 0.875rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1.25rem;
}

.nav-container.is-wide {
  max-width: 96%;
}

.brand-logo {
  max-width: 35%;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  color: var(--md-sys-color-on-surface);
  min-width: 0;
  flex-shrink: 0;
  font-size: 1.25rem;
  font-weight: 700;
}

.logo-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logo-img {
  flex-shrink: 0;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-item {
  text-decoration: none;
  color: #4a5568;
  font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.nav-item:hover,
.nav-item.router-link-active {
  color: #2b6cb0;
}

.nav-auth {
  display: flex;
  align-items: center;
}

.btn-auth {
  min-height: 44px;
  padding: 0.5rem 1.25rem;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.btn-auth:hover {
  box-shadow: var(--md-sys-elevation-1);
}

.user-menu-wrapper {
  position: relative;
}

.user-profile-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
  min-height: 44px;
  max-width: 220px;
  padding: 0.375rem 0.75rem;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
  transition: border-color 0.2s;
}

.user-profile-btn:hover {
  border-color: var(--md-sys-color-outline, #cbd5e0);
}

.user-avatar {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  background-color: var(--md-sys-color-primary, #3182ce);
  color: var(--md-sys-color-on-primary, #ffffff);
  border-radius: 50%;
  font-size: 0.8rem;
  font-weight: 600;
}

.user-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--md-sys-color-on-surface, #2d3748);
}

.caret-icon {
  font-size: 0.65rem;
  color: var(--md-sys-color-on-surface-variant, #718096);
}

.user-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  width: min(240px, calc(100vw - 2rem));
  background-color: var(--md-sys-color-surface-container, #ffffff);
  border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
  border-radius: 8px;
  box-shadow: var(--md-sys-elevation-2, 0 4px 12px rgba(0, 0, 0, 0.1));
  padding: 0.5rem 0;
  display: flex;
  flex-direction: column;
  z-index: 101;
}

.dropdown-header {
  padding: 0.4rem 1rem;
  display: flex;
  flex-direction: column;
}

.header-name {
  overflow-wrap: anywhere;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--md-sys-color-on-surface, #1a202c);
}

.header-username {
  overflow-wrap: anywhere;
  font-size: 0.8rem;
  color: var(--md-sys-color-on-surface-variant, #718096);
}

.dropdown-divider {
  border: none;
  border-top: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
  margin: 0.4rem 0;
}

.dropdown-item {
  display: block;
  min-height: 44px;
  padding: 0.625rem 1rem;
  font-size: 0.9rem;
  color: var(--md-sys-color-on-surface, #4a5568);
  text-decoration: none;
  text-align: left;
  background: none;
  border: none;
  width: 100%;
  cursor: pointer;
}

.dropdown-item:hover {
  background-color: var(--md-sys-color-surface-container-high, #f7fafc);
  color: var(--md-sys-color-primary, #2b6cb0);
}

.dropdown-item.logout-btn {
  color: var(--md-sys-color-error, #e53e3e);
}

.dropdown-item.logout-btn:hover {
  background-color: var(--md-sys-color-error-container, #fff5f5);
  color: var(--md-sys-color-on-error-container);
}

/* Header layout & search bar styles */
.nav-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-shrink: 0;
}

.header-search-wrapper {
  flex: 1;
  min-width: 0;
  max-width: 480px;
}

.header-search-box {
  position: relative;
  display: flex;
  align-items: center;
  background-color: var(--md-sys-color-surface-container-high, #e9eef6);
  border: 1px solid transparent;
  border-radius: var(--md-sys-shape-corner-xl, 24px);
  min-height: 48px;
  padding: 0.25rem 0.75rem;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

.header-search-box:hover {
  background-color: var(--md-sys-color-surface-container-high, #e2e8f0);
  box-shadow: var(--md-sys-elevation-1);
}

.header-search-box.focused {
  background-color: var(--md-sys-color-surface-container, #ffffff);
  border-color: var(--md-sys-color-primary);
  box-shadow: var(--md-sys-elevation-1);
}

.header-search-icon {
  font-size: 0.85rem;
  margin-right: 0.45rem;
  color: var(--md-sys-color-on-surface-variant, #64748b);
  flex-shrink: 0;
  line-height: 1;
}

.header-search-input {
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 0.875rem;
  color: var(--md-sys-color-on-surface, #1e293b);
  padding: 0.2rem 0;
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
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  font-size: 1.25rem;
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-full);
}

.header-search-clear:hover {
  color: var(--md-sys-color-on-surface);
  background: var(--md-sys-color-surface-container-high);
}

.header-search-shortcut {
  flex-shrink: 0;
  margin-left: 0.5rem;
  pointer-events: none;
}

.header-search-shortcut kbd {
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  border-radius: var(--md-sys-shape-corner-xs);
}

.header-theme-toggle {
  display: flex;
  align-items: center;
}

.header-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background-color: var(--md-sys-color-surface-container-low, #f8fafc);
  border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
  border-radius: 20px;
  min-width: 44px;
  min-height: 44px;
  padding: 0.5rem 0.75rem;
  font-size: 0.825rem;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant, #475569);
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.header-toggle-btn:hover {
  background-color: var(--md-sys-color-surface-container-high, #edf2f7);
  border-color: var(--md-sys-color-outline, #cbd5e1);
  color: var(--md-sys-color-on-surface, #1e293b);
}

.header-toggle-btn.active {
  background-color: var(--md-sys-color-primary-container, #ebf8ff);
  border-color: var(--md-sys-color-primary, #90cdf4);
  color: var(--md-sys-color-on-primary-container, #2b6cb0);
  font-weight: 600;
}

@media (max-width: 768px) {
  .nav-container {
    padding: 0.75rem 1rem;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .nav-container.is-wide {
    max-width: 100%;
  }

  .brand-logo {
    max-width: calc(100% - 112px);
  }

  .logo-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-right {
    margin-left: auto;
    gap: 0.5rem;
  }

  .header-search-wrapper {
    order: 3;
    flex-basis: 100%;
    max-width: none;
  }

  .header-search-input {
    font-size: 1rem;
  }

  .header-search-shortcut,
  .header-toggle-btn .btn-label,
  .user-name,
  .caret-icon {
    display: none;
  }

  .header-toggle-btn {
    padding: 0.5rem;
  }

  .user-profile-btn {
    width: 44px;
    padding: 0;
    justify-content: center;
  }
}
</style>
