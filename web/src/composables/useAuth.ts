import { ref, computed } from 'vue';
import {
  api,
  type UserProfile,
  onUnauthorized,
  ApiError,
} from '../api/client';
import { resetNotesState } from './useNotes';
import { resetSettingsState } from './useSettings';

export interface RegisterPayload {
  username: string;
  email: string;
  displayName: string;
  password: string;
}

// Module-level singleton state so all components and views share the same auth context
const user = ref<UserProfile | null>(null);
const isLoading = ref(false);
const authError = ref<string | null>(null);
const sessionExpired = ref(false);
const isFirstUser = ref(false);
const initialized = ref(false);
const SESSION_STORAGE_KEY = 'meemo_has_session';

function resetUserScopedState(): void {
  resetNotesState();
  resetSettingsState();
}

function setUser(nextUser: UserProfile | null): void {
  if (user.value?.id !== nextUser?.id) resetUserScopedState();
  user.value = nextUser;
}

function setSessionMarker(active: boolean) {
  if (typeof localStorage !== 'undefined') {
    if (active) {
      localStorage.setItem(SESSION_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }
}

// Register 401 unauthorized listener to handle expired or invalid sessions
onUnauthorized((path: string) => {
  setSessionMarker(false);
  resetUserScopedState();
  if (user.value) {
    user.value = null;
    sessionExpired.value = true;
  } else if (path !== '/api/profile') {
    sessionExpired.value = true;
  }
});

export function useAuth() {
  const isAuthenticated = computed(() => !!user.value);
  const displayName = computed(() => user.value?.displayName || user.value?.username || '');

  async function checkFirstUser(): Promise<boolean> {
    try {
      const res = await api.public.users();
      isFirstUser.value = !res.users || res.users.length === 0;
    } catch {
      isFirstUser.value = false;
    }
    return isFirstUser.value;
  }

  async function init(force = false): Promise<void> {
    if (initialized.value && !force) return;

    isLoading.value = true;
    authError.value = null;
    try {
      const res = await api.auth.profile();
      setUser(res.user);
      sessionExpired.value = false;
      isFirstUser.value = false;
      setSessionMarker(true);
    } catch (err: any) {
      setUser(null);
      setSessionMarker(false);
      if (err instanceof ApiError && err.status === 401) {
        await checkFirstUser();
      } else {
        authError.value = err.message || 'Failed to authenticate';
      }
    } finally {
      isLoading.value = false;
      initialized.value = true;
    }
  }

  async function login(username: string, password: string): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    authError.value = null;
    try {
      await api.auth.login(username.trim().toLowerCase(), password);
      const res = await api.auth.profile();
      setUser(res.user);
      sessionExpired.value = false;
      isFirstUser.value = false;
      setSessionMarker(true);
      return { success: true };
    } catch (err: any) {
      const msg = err.message || 'Invalid username or password';
      authError.value = msg;
      return { success: false, error: msg };
    } finally {
      isLoading.value = false;
    }
  }

  async function register(payload: RegisterPayload): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    authError.value = null;
    try {
      await api.auth.register({
        username: payload.username.trim().toLowerCase(),
        email: payload.email.trim(),
        displayName: payload.displayName.trim(),
        password: payload.password,
      });

      // Automatically log in following successful registration
      const loginRes = await login(payload.username, payload.password);
      if (loginRes.success) {
        isFirstUser.value = false;
        return { success: true };
      }
      return loginRes;
    } catch (err: any) {
      const msg = err.message || 'Registration failed';
      authError.value = msg;
      return { success: false, error: msg };
    } finally {
      isLoading.value = false;
    }
  }

  async function logout(): Promise<void> {
    isLoading.value = true;
    setSessionMarker(false);
    resetUserScopedState();
    try {
      await api.auth.logout();
    } catch (err) {
      // Ignore network errors during logout to allow local session clear
      console.warn('Logout warning:', err);
    } finally {
      user.value = null;
      sessionExpired.value = false;
      authError.value = null;
      isLoading.value = false;
      await checkFirstUser();
    }
  }

  function clearError(): void {
    authError.value = null;
  }

  function dismissSessionExpired(): void {
    sessionExpired.value = false;
  }

  function setSessionExpired(expired = true): void {
    sessionExpired.value = expired;
    if (expired) {
      resetUserScopedState();
      user.value = null;
    }
  }

  // Testing helper to reset internal state
  function _resetState(): void {
    resetUserScopedState();
    user.value = null;
    isLoading.value = false;
    authError.value = null;
    sessionExpired.value = false;
    isFirstUser.value = false;
    initialized.value = false;
  }

  return {
    // Reactive state
    user,
    isLoading,
    authError,
    sessionExpired,
    isFirstUser,
    initialized,

    // Computed
    isAuthenticated,
    displayName,

    // Actions
    init,
    checkFirstUser,
    login,
    register,
    logout,
    clearError,
    dismissSessionExpired,
    setSessionExpired,
    _resetState,
  };
}
