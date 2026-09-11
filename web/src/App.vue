<template>
  <div id="meemo-app">
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
            <span class="header-search-icon" aria-hidden="true">🔍</span>
            <input
              ref="headerSearchInputRef"
              v-model="headerSearchQuery"
              type="search"
              class="header-search-input"
              placeholder="Search notes or #tags... (Ctrl+K)"
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
          <!-- View Toggle: Active Notes / Archive -->
          <div v-if="isAuthenticated" class="header-view-toggle">
            <button
              type="button"
              class="header-toggle-btn"
              :class="{ active: isArchived }"
              @click="handleToggleArchiveView"
              :title="isArchived ? 'Back to active notes' : 'View archived notes'"
            >
              <span class="btn-icon">{{ isArchived ? '↩️' : '📦' }}</span>
              <span class="btn-label">{{ isArchived ? 'Active' : 'Archive' }}</span>
            </button>
          </div>

          <div class="nav-auth">
            <!-- Authenticated User Profile Dropdown -->
            <div v-if="isAuthenticated && user" class="user-menu-wrapper">
            <button
              type="button"
              class="user-profile-btn"
              @click="toggleUserMenu"
              :aria-expanded="showUserMenu"
              aria-haspopup="true"
            >
              <span class="user-avatar">{{ userAvatarInitial }}</span>
              <span class="user-name">{{ user.displayName || user.username }}</span>
              <span class="caret-icon">▼</span>
            </button>

            <div v-if="showUserMenu" class="user-dropdown-menu" role="menu">
              <div class="dropdown-header">
                <span class="header-name">{{ user.displayName }}</span>
                <span class="header-username">@{{ user.username }}</span>
              </div>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                @click="openSettings"
              >
                Settings
              </button>
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                @click="openCheatsheet"
              >
                Cheatsheet
              </button>
              <router-link
                :to="`/public/${user.username}`"
                class="dropdown-item"
                role="menuitem"
                @click="closeUserMenu"
              >
                Public Feed
              </router-link>
              <a
                :href="`/api/rss/${user.username}`"
                target="_blank"
                rel="noopener"
                class="dropdown-item"
                role="menuitem"
                @click="closeUserMenu"
              >
                RSS Feed
              </a>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item"
                role="menuitem"
                @click="openImport"
              >
                Import
              </button>
              <a
                href="/api/export"
                class="dropdown-item"
                role="menuitem"
                download="meemo-export.tar"
                @click="closeUserMenu"
              >
                Export
              </a>
              <hr class="dropdown-divider" />
              <button
                type="button"
                class="dropdown-item logout-btn"
                role="menuitem"
                @click="handleLogout"
              >
                Log Out
              </button>
            </div>
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
    <router-view />

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
import { useSettings } from './composables/useSettings';
import { useNotes } from './composables/useNotes';
import LoginModal from './components/LoginModal.vue';

const router = useRouter();
const route = useRoute();

const {
  searchQuery,
  isArchived,
  setSearch,
  toggleArchived,
} = useNotes();

const headerSearchQuery = ref('');
const isSearchFocused = ref(false);
const headerSearchInputRef = ref<HTMLInputElement | null>(null);
let headerSearchTimer: number | null = null;

// Sync header input with active searchQuery
watch(searchQuery, (newVal) => {
  if (headerSearchQuery.value !== newVal) {
    headerSearchQuery.value = newVal;
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
  if (route.path !== '/') {
    router.push({ path: '/', query: { q: q || undefined } });
  } else {
    router.replace({ query: { ...route.query, q: q || undefined } });
  }
  setSearch(q);
}

function handleHeaderSearchClear() {
  if (headerSearchTimer) clearTimeout(headerSearchTimer);
  headerSearchQuery.value = '';
  if (route.path === '/') {
    const newQuery = { ...route.query };
    delete newQuery.q;
    router.replace({ query: newQuery });
  }
  setSearch('');
  headerSearchInputRef.value?.focus();
}

function handleToggleArchiveView() {
  if (route.path !== '/') {
    router.push('/');
  }
  toggleArchived();
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

const { settings, loadSettings } = useSettings();

const showAuthModal = ref(false);
const authModalTab = ref<'login' | 'register'>('login');
const showUserMenu = ref(false);

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

function closeUserMenu() {
  showUserMenu.value = false;
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

  // Sync initial search from URL query if present
  if (route.query.q && typeof route.query.q === 'string') {
    headerSearchQuery.value = route.query.q;
    setSearch(route.query.q);
  }
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

body {
  background-color: #f7fafc;
  color: #2d3748;
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
  background-color: #fffaf0;
  border-bottom: 1px solid #feebc8;
  color: #c05621;
  padding: 0.6rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.9rem;
}

.banner-content {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.banner-actions {
  display: flex;
  gap: 0.5rem;
}

.banner-btn {
  padding: 0.25rem 0.6rem;
  border-radius: 4px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
}

.banner-btn.primary {
  background-color: #dd6b20;
  color: #ffffff;
}

.banner-btn.primary:hover {
  background-color: #c05621;
}

.banner-btn.secondary {
  background-color: transparent;
  color: #7b341e;
}

.banner-btn.secondary:hover {
  background-color: #fbd38d;
}

.app-nav {
  background-color: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  position: sticky;
  top: 0;
  z-index: 100;
}

.nav-container {
  max-width: 1040px;
  margin: 0 auto;
  padding: 0.75rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
  transition: max-width 0.2s;
}

.nav-container.is-wide {
  max-width: 96%;
}

.brand-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  text-decoration: none;
  color: #2b6cb0;
  font-size: 1.25rem;
  font-weight: 700;
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
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color 0.2s;
}

.btn-auth.login-btn {
  background-color: #2b6cb0;
  color: #ffffff;
}

.btn-auth.login-btn:hover {
  background-color: #2c5282;
}

.btn-auth.setup-btn {
  background-color: #38a169;
  color: #ffffff;
}

.btn-auth.setup-btn:hover {
  background-color: #2f855a;
}

.user-menu-wrapper {
  position: relative;
}

.user-profile-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: none;
  border: 1px solid #e2e8f0;
  padding: 0.3rem 0.6rem;
  border-radius: 20px;
  cursor: pointer;
  transition: border-color 0.2s;
}

.user-profile-btn:hover {
  border-color: #cbd5e0;
}

.user-avatar {
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 26px;
  height: 26px;
  background-color: #3182ce;
  color: #ffffff;
  border-radius: 50%;
  font-size: 0.8rem;
  font-weight: 600;
}

.user-name {
  font-size: 0.9rem;
  font-weight: 500;
  color: #2d3748;
}

.caret-icon {
  font-size: 0.65rem;
  color: #718096;
}

.user-dropdown-menu {
  position: absolute;
  right: 0;
  top: calc(100% + 0.5rem);
  width: 180px;
  background-color: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
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
  font-weight: 600;
  font-size: 0.9rem;
  color: #1a202c;
}

.header-username {
  font-size: 0.8rem;
  color: #718096;
}

.dropdown-divider {
  border: none;
  border-top: 1px solid #edf2f7;
  margin: 0.4rem 0;
}

.dropdown-item {
  display: block;
  padding: 0.4rem 1rem;
  font-size: 0.9rem;
  color: #4a5568;
  text-decoration: none;
  text-align: left;
  background: none;
  border: none;
  width: 100%;
  cursor: pointer;
}

.dropdown-item:hover {
  background-color: #f7fafc;
  color: #2b6cb0;
}

.dropdown-item.logout-btn {
  color: #e53e3e;
}

.dropdown-item.logout-btn:hover {
  background-color: #fff5f5;
  color: #c53030;
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
  max-width: 480px;
  margin: 0 1rem;
}

.header-search-box {
  position: relative;
  display: flex;
  align-items: center;
  background-color: #f1f5f9;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 0.25rem 0.75rem;
  transition: all 0.2s ease;
}

.header-search-box:hover {
  background-color: #eef2f6;
  border-color: #cbd5e1;
}

.header-search-box.focused {
  background-color: #ffffff;
  border-color: #3182ce;
  box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.15);
}

.header-search-icon {
  font-size: 0.85rem;
  margin-right: 0.45rem;
  color: #64748b;
  flex-shrink: 0;
  line-height: 1;
}

.header-search-input {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 0.875rem;
  color: #1e293b;
  outline: none;
  padding: 0.2rem 0;
}

.header-search-input::placeholder {
  color: #94a3b8;
}

.header-search-clear {
  background: none;
  border: none;
  color: #94a3b8;
  font-size: 1rem;
  cursor: pointer;
  padding: 0.1rem 0.35rem;
  border-radius: 50%;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s, background-color 0.15s;
}

.header-search-clear:hover {
  color: #475569;
  background-color: #e2e8f0;
}

.header-search-shortcut {
  flex-shrink: 0;
  margin-left: 0.35rem;
  pointer-events: none;
}

.header-search-shortcut kbd {
  background-color: #e2e8f0;
  border: 1px solid #cbd5e1;
  color: #64748b;
  font-family: inherit;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 0.1rem 0.35rem;
  border-radius: 4px;
}

.header-view-toggle {
  display: flex;
  align-items: center;
}

.header-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background-color: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  padding: 0.32rem 0.75rem;
  font-size: 0.825rem;
  font-weight: 500;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.header-toggle-btn:hover {
  background-color: #edf2f7;
  border-color: #cbd5e1;
  color: #1e293b;
}

.header-toggle-btn.active {
  background-color: #ebf8ff;
  border-color: #90cdf4;
  color: #2b6cb0;
  font-weight: 600;
}

@media (max-width: 768px) {
  .nav-container {
    padding: 0.5rem 0.75rem;
    gap: 0.5rem;
  }

  .brand-logo .logo-text {
    display: none;
  }

  .header-search-wrapper {
    margin: 0 0.25rem;
    max-width: none;
  }

  .header-search-shortcut {
    display: none;
  }

  .header-toggle-btn .btn-label {
    display: none;
  }

  .header-toggle-btn {
    padding: 0.35rem 0.5rem;
  }

  .nav-links {
    display: none;
  }
}
</style>
