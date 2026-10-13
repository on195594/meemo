<template>
  <div v-if="modelValue" class="modal-overlay" @click.self="handleClose" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-card">
      <header class="modal-header">
        <h2 id="modal-title" class="modal-title">
          {{ isFirstUser ? 'Create First Account' : (activeTab === 'login' ? 'Log In to Meemo' : 'Create Account') }}
        </h2>
        <button type="button" class="close-btn" @click="handleClose" aria-label="Close modal">
          &times;
        </button>
      </header>

      <!-- First-User Setup Banner -->
      <div v-if="isFirstUser" class="first-user-banner" role="status">
        <strong>Initial Setup:</strong> No user accounts exist yet. Create your administrator account to get started.
      </div>

      <!-- Tab Switcher (hidden or disabled if first-user to guide setup) -->
      <div v-if="!isFirstUser" class="tab-switcher">
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'login' }"
          @click="switchTab('login')"
        >
          Log In
        </button>
        <button
          type="button"
          class="tab-btn"
          :class="{ active: activeTab === 'register' }"
          @click="switchTab('register')"
        >
          Register
        </button>
      </div>

      <!-- Error Message Banner -->
      <div v-if="errorMessage" class="error-banner" role="alert">
        {{ errorMessage }}
      </div>

      <!-- Login Form -->
      <form v-if="activeTab === 'login'" @submit.prevent="handleLogin" class="auth-form">
        <div class="form-group">
          <label for="login-username">Username</label>
          <input
            id="login-username"
            v-model="loginUsername"
            type="text"
            required
            autocomplete="username"
            placeholder="Username"
            :disabled="isLoading"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label for="login-password">Password</label>
          <input
            id="login-password"
            v-model="loginPassword"
            type="password"
            required
            autocomplete="current-password"
            placeholder="Password"
            :disabled="isLoading"
            class="form-input"
          />
        </div>

        <div class="form-actions">
          <button type="submit" class="submit-btn primary" :disabled="isLoading">
            <span v-if="isLoading">Signing in...</span>
            <span v-else>Log In</span>
          </button>
        </div>
      </form>

      <!-- Register Form -->
      <form v-else @submit.prevent="handleRegister" class="auth-form">
        <div class="form-group">
          <label for="reg-username">Username</label>
          <input
            id="reg-username"
            v-model="regUsername"
            type="text"
            required
            autocomplete="username"
            placeholder="e.g. admin"
            :disabled="isLoading"
            class="form-input"
          />
          <span class="field-hint">3-32 characters: lowercase letters, numbers, _, -</span>
        </div>

        <div class="form-group">
          <label for="reg-displayName">Display Name</label>
          <input
            id="reg-displayName"
            v-model="regDisplayName"
            type="text"
            required
            autocomplete="name"
            placeholder="e.g. Administrator"
            :disabled="isLoading"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label for="reg-email">Email Address</label>
          <input
            id="reg-email"
            v-model="regEmail"
            type="email"
            required
            autocomplete="email"
            placeholder="user@example.com"
            :disabled="isLoading"
            class="form-input"
          />
        </div>

        <div class="form-group">
          <label for="reg-password">Password</label>
          <input
            id="reg-password"
            v-model="regPassword"
            type="password"
            required
            autocomplete="new-password"
            placeholder="At least 8 characters"
            :disabled="isLoading"
            class="form-input"
          />
        </div>

        <div class="form-actions">
          <button type="submit" class="submit-btn primary" :disabled="isLoading">
            <span v-if="isLoading">Creating account...</span>
            <span v-else>{{ isFirstUser ? 'Create Administrator Account' : 'Register' }}</span>
          </button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useAuth } from '../composables/useAuth';

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    initialTab?: 'login' | 'register';
  }>(),
  {
    initialTab: 'login',
  }
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'success'): void;
}>();

const { isLoading, authError, isFirstUser, login, register, clearError } = useAuth();

const activeTab = ref<'login' | 'register'>('login');
const errorMessage = ref<string | null>(null);

// Login fields
const loginUsername = ref('');
const loginPassword = ref('');

// Register fields
const regUsername = ref('');
const regDisplayName = ref('');
const regEmail = ref('');
const regPassword = ref('');

// Synchronize tab with props and first-user status
watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      clearError();
      errorMessage.value = null;
      if (isFirstUser.value) {
        activeTab.value = 'register';
      } else {
        activeTab.value = props.initialTab || 'login';
      }
    }
  },
  { immediate: true }
);

watch(
  () => isFirstUser.value,
  (firstUser) => {
    if (firstUser) {
      activeTab.value = 'register';
    }
  }
);

watch(authError, (err) => {
  if (err) errorMessage.value = err;
});

function switchTab(tab: 'login' | 'register') {
  activeTab.value = tab;
  errorMessage.value = null;
  clearError();
}

function handleClose() {
  emit('update:modelValue', false);
}

async function handleLogin() {
  errorMessage.value = null;
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    errorMessage.value = 'Please enter both username and password.';
    return;
  }

  const result = await login(username, password);
  if (result.success) {
    loginPassword.value = '';
    emit('success');
    emit('update:modelValue', false);
  } else {
    errorMessage.value = result.error || 'Invalid username or password';
  }
}

async function handleRegister() {
  errorMessage.value = null;
  const username = regUsername.value.trim().toLowerCase();
  const displayName = regDisplayName.value.trim();
  const email = regEmail.value.trim();
  const password = regPassword.value;

  // Client validation
  if (!/^[a-z0-9_\-]{3,32}$/.test(username)) {
    errorMessage.value = 'Username must be 3-32 characters containing only letters, numbers, _, -';
    return;
  }
  if (!displayName || displayName.length > 64) {
    errorMessage.value = 'Display name must be between 1 and 64 characters';
    return;
  }
  if (!email || !email.includes('@')) {
    errorMessage.value = 'Please provide a valid email address';
    return;
  }
  if (password.length < 8 || password.length > 128) {
    errorMessage.value = 'Password must be between 8 and 128 characters';
    return;
  }

  const result = await register({
    username,
    displayName,
    email,
    password,
  });

  if (result.success) {
    regPassword.value = '';
    emit('success');
    emit('update:modelValue', false);
  } else {
    errorMessage.value = result.error || 'Registration failed';
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: var(--md-sys-color-scrim);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  z-index: 1000;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: overlay-in var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.modal-card {
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-2xl);
  width: 100%;
  max-width: 440px;
  box-shadow: var(--md-sys-elevation-3);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  animation: card-in var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

@keyframes overlay-in {
  from { opacity: 0; }
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(8px);
  }
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 1rem 0.75rem 1.5rem;
}

.modal-title {
  font-size: var(--md-sys-typescale-headline-small);
  font-weight: 400;
  color: var(--md-sys-color-on-surface);
  margin: 0;
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-full);
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.close-btn:hover {
  background: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

.first-user-banner {
  margin: 0.5rem 1.5rem 0.75rem;
  padding: 0.75rem 1rem;
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-radius: var(--md-sys-shape-corner-md);
  font-size: var(--md-sys-typescale-body-medium);
}

.tab-switcher {
  display: flex;
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  margin: 0 1.5rem;
}

.tab-btn {
  position: relative;
  flex: 1;
  min-height: 48px;
  background: none;
  border: none;
  padding: 0.75rem;
  font-size: var(--md-sys-typescale-title-small);
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  border-radius: var(--md-sys-shape-corner-sm) var(--md-sys-shape-corner-sm) 0 0;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.tab-btn:hover {
  background: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

/* M3 primary tab indicator: 3px, rounded top, grows from the center */
.tab-btn::after {
  content: '';
  position: absolute;
  left: 25%;
  right: 25%;
  bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--md-sys-color-primary);
  transform: scaleX(0);
  transition: transform var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.tab-btn.active {
  color: var(--md-sys-color-primary);
}

.tab-btn.active::after {
  transform: scaleX(1);
}

.error-banner {
  margin: 1rem 1.5rem 0;
  padding: 0.625rem 1rem;
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  border-radius: var(--md-sys-shape-corner-md);
  font-size: var(--md-sys-typescale-body-medium);
}

.auth-form {
  padding: 1.25rem 1.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.form-group label {
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  transition: color var(--md-sys-motion-duration-short) ease;
}

.form-group:focus-within label {
  color: var(--md-sys-color-primary);
}

.form-input {
  min-height: 48px;
  padding: 0.625rem 1rem;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-xs);
  font-size: var(--md-sys-typescale-body-large);
  background-color: transparent;
  color: var(--md-sys-color-on-surface);
  outline: none;
  transition: border-color var(--md-sys-motion-duration-short) ease,
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.form-input:hover {
  border-color: var(--md-sys-color-on-surface);
}

/* M3 outlined field focus: 2px primary stroke without layout shift */
.form-input:focus,
.form-input:focus-visible {
  outline: none;
  border-color: var(--md-sys-color-primary);
  box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
}

.field-hint {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.form-actions {
  margin-top: 0.5rem;
}

.submit-btn {
  width: 100%;
  min-height: 48px;
  padding: 0.65rem 1.5rem;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short) ease,
              transform var(--md-sys-motion-duration-short) var(--md-sys-motion-easing),
              opacity var(--md-sys-motion-duration-short) ease;
}

.submit-btn.primary {
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.submit-btn.primary:hover:not(:disabled) {
  box-shadow: var(--md-sys-elevation-1);
}

.submit-btn.primary:active:not(:disabled) {
  transform: scale(0.98);
  box-shadow: none;
}

.submit-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}
</style>
