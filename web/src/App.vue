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
      <div class="nav-container">
        <router-link to="/" class="brand-logo">
          <img src="/favicon.png" alt="Meemo" class="logo-img" width="28" height="28" />
          <span>Meemo</span>
        </router-link>

        <nav class="nav-links">
          <router-link to="/" class="nav-item">Notes</router-link>
          <router-link v-if="user" :to="`/public/${user.username}`" class="nav-item">
            My Public Stream
          </router-link>
        </nav>

        <div class="nav-auth">
          <!-- Authenticated User Profile Dropdown -->
          <div v-if="isAuthenticated && user" class="user-menu-wrapper" v-click-outside="closeUserMenu">
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
    </header>

    <!-- Main View Content -->
    <router-view />

    <!-- Auth Login / Register Modal -->
    <LoginModal
      v-model="showAuthModal"
      :initial-tab="authModalTab"
      @success="onAuthSuccess"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, provide } from 'vue';
import { useAuth } from './composables/useAuth';
import LoginModal from './components/LoginModal.vue';

const {
  user,
  isAuthenticated,
  sessionExpired,
  isFirstUser,
  init,
  logout,
  dismissSessionExpired,
} = useAuth();

const showAuthModal = ref(false);
const authModalTab = ref<'login' | 'register'>('login');
const showUserMenu = ref(false);

function openLoginModal(tab: 'login' | 'register' = 'login') {
  authModalTab.value = isFirstUser.value ? 'register' : tab;
  showAuthModal.value = true;
  showUserMenu.value = false;
}

const userAvatarInitial = computed(() => {
  if (!user.value) return '?';
  const name = user.value.displayName || user.value.username;
  return name ? name.charAt(0).toUpperCase() : '?';
});

provide('openAuthModal', openLoginModal);

function toggleUserMenu() {
  showUserMenu.value = !showUserMenu.value;
}

function closeUserMenu() {
  showUserMenu.value = false;
}

function onAuthSuccess() {
  showAuthModal.value = false;
  showUserMenu.value = false;
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

onMounted(() => {
  init();
  document.addEventListener('click', handleGlobalClick);
});

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
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
  max-width: 1000px;
  margin: 0 auto;
  padding: 0.75rem 1.5rem;
  display: flex;
  justify-content: space-between;
  align-items: center;
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
</style>
