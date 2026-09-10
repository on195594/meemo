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
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1rem;
  z-index: 1000;
  backdrop-filter: blur(2px);
}

.modal-card {
  background: #ffffff;
  border-radius: 10px;
  width: 100%;
  max-width: 440px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem 0.75rem;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a202c;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #718096;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
}

.close-btn:hover {
  color: #2d3748;
}

.first-user-banner {
  margin: 0.5rem 1.5rem 0.75rem;
  padding: 0.75rem;
  background-color: #ebf8ff;
  border: 1px solid #bee3f8;
  color: #2b6cb0;
  border-radius: 6px;
  font-size: 0.9rem;
}

.tab-switcher {
  display: flex;
  border-bottom: 1px solid #e2e8f0;
  margin: 0 1.5rem;
}

.tab-btn {
  flex: 1;
  background: none;
  border: none;
  padding: 0.75rem;
  font-size: 0.95rem;
  font-weight: 500;
  color: #718096;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s ease;
}

.tab-btn.active {
  color: #2b6cb0;
  border-bottom-color: #2b6cb0;
}

.error-banner {
  margin: 1rem 1.5rem 0;
  padding: 0.6rem 0.8rem;
  background-color: #fff5f5;
  border: 1px solid #fed7d7;
  color: #c53030;
  border-radius: 6px;
  font-size: 0.875rem;
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
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
}

.form-input {
  padding: 0.6rem 0.75rem;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

.form-input:focus {
  border-color: #3182ce;
  box-shadow: 0 0 0 2px rgba(49, 130, 206, 0.2);
}

.field-hint {
  font-size: 0.75rem;
  color: #718096;
}

.form-actions {
  margin-top: 0.5rem;
}

.submit-btn {
  width: 100%;
  padding: 0.65rem 1rem;
  border: none;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.submit-btn.primary {
  background-color: #2b6cb0;
  color: #ffffff;
}

.submit-btn.primary:hover:not(:disabled) {
  background-color: #2c5282;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
