import { ref } from 'vue';
import { api } from '../api/client';

export type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_STORAGE_KEY = 'meemo_theme';

export function getStoredTheme(): ThemeMode {
  if (typeof localStorage !== 'undefined') {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'auto') {
      return val;
    }
  }
  return 'auto';
}

export function applyThemeToDOM(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.setAttribute('data-theme', 'dark');
    root.style.colorScheme = 'dark';
  } else if (theme === 'light') {
    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';
  } else {
    root.removeAttribute('data-theme');
    root.style.colorScheme = '';
  }
}

export function setStoredTheme(theme: ThemeMode): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
  applyThemeToDOM(theme);
}

export interface AppSettings {
  title?: string;
  theme?: ThemeMode;
  wide?: boolean;
  wideNavbar?: boolean;
  publicBackground?: boolean;
  showTagSidebar?: boolean;
  keepPositionAfterEdit?: boolean;
  backgroundImageDataUrl?: string;
}

const defaultSettings: AppSettings = {
  title: 'Meemo',
  theme: 'auto',
  wide: false,
  wideNavbar: false,
  publicBackground: false,
  showTagSidebar: true,
  keepPositionAfterEdit: false,
  backgroundImageDataUrl: '',
};

const settings = ref<AppSettings>({ ...defaultSettings });
const isLoading = ref(false);
const error = ref<string | null>(null);
let requestGeneration = 0;

function applyToDOM(s: AppSettings) {
  if (typeof document !== 'undefined') {
    document.title = s.title || 'Meemo';
    const activeTheme = s.theme || getStoredTheme();
    applyThemeToDOM(activeTheme);
    if (s.backgroundImageDataUrl) {
      document.body.style.backgroundImage = `url("${s.backgroundImageDataUrl}")`;
      document.body.style.backgroundSize = 'cover';
      document.body.style.backgroundAttachment = 'fixed';
    } else {
      document.body.style.backgroundImage = '';
    }
  }
}

// Initial theme application
if (typeof document !== 'undefined') {
  applyThemeToDOM(getStoredTheme());
}

export function resetSettingsState(): void {
  requestGeneration++;
  settings.value = { ...defaultSettings };
  isLoading.value = false;
  error.value = null;
  applyToDOM(settings.value);
}

export function useSettings() {
  async function loadSettings(): Promise<AppSettings> {
    const generation = ++requestGeneration;
    isLoading.value = true;
    error.value = null;
    try {
      const res = await api.settings.get();
      if (generation !== requestGeneration) return settings.value;
      const loaded = (res.settings || {}) as AppSettings;
      if (loaded.theme) {
        setStoredTheme(loaded.theme);
      }
      settings.value = {
        ...defaultSettings,
        theme: getStoredTheme(),
        ...loaded,
      };
      applyToDOM(settings.value);
      return settings.value;
    } catch (err: any) {
      if (generation !== requestGeneration) return settings.value;
      if (err.status !== 401) {
        error.value = err.message || 'Failed to load settings';
      }
      return settings.value;
    } finally {
      if (generation === requestGeneration) isLoading.value = false;
    }
  }

  async function saveSettings(updates: Partial<AppSettings>): Promise<{ success: boolean; error?: string }> {
    const generation = ++requestGeneration;
    isLoading.value = true;
    error.value = null;
    if (updates.theme) {
      setStoredTheme(updates.theme);
    }
    const merged = {
      ...settings.value,
      ...updates,
    };

    try {
      await api.settings.save(merged as Record<string, unknown>);
      if (generation !== requestGeneration) return { success: false, error: 'Session changed' };
      settings.value = merged;
      applyToDOM(settings.value);
      return { success: true };
    } catch (err: any) {
      if (generation !== requestGeneration) return { success: false, error: 'Session changed' };
      const msg = err.message || 'Failed to save settings';
      error.value = msg;
      return { success: false, error: msg };
    } finally {
      if (generation === requestGeneration) isLoading.value = false;
    }
  }

  return {
    settings,
    isLoading,
    error,
    loadSettings,
    saveSettings,
    reset: resetSettingsState,
  };
}
