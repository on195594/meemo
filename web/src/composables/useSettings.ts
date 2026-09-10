import { ref } from 'vue';
import { api } from '../api/client';

export interface AppSettings {
  title?: string;
  wide?: boolean;
  wideNavbar?: boolean;
  publicBackground?: boolean;
  showTagSidebar?: boolean;
  keepPositionAfterEdit?: boolean;
  backgroundImageDataUrl?: string;
}

const defaultSettings: AppSettings = {
  title: 'Meemo',
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

export function useSettings() {
  function applyToDOM(s: AppSettings) {
    if (typeof document !== 'undefined') {
      document.title = s.title || 'Meemo';
      if (s.backgroundImageDataUrl) {
        document.body.style.backgroundImage = `url("${s.backgroundImageDataUrl}")`;
        document.body.style.backgroundSize = 'cover';
        document.body.style.backgroundAttachment = 'fixed';
      } else {
        document.body.style.backgroundImage = '';
      }
    }
  }

  async function loadSettings(): Promise<AppSettings> {
    isLoading.value = true;
    error.value = null;
    try {
      const res = await api.settings.get();
      const loaded = (res.settings || {}) as AppSettings;
      settings.value = {
        ...defaultSettings,
        ...loaded,
      };
      applyToDOM(settings.value);
      return settings.value;
    } catch (err: any) {
      if (err.status !== 401) {
        error.value = err.message || 'Failed to load settings';
      }
      return settings.value;
    } finally {
      isLoading.value = false;
    }
  }

  async function saveSettings(updates: Partial<AppSettings>): Promise<{ success: boolean; error?: string }> {
    isLoading.value = true;
    error.value = null;
    const merged = {
      ...settings.value,
      ...updates,
    };

    try {
      await api.settings.save(merged as Record<string, unknown>);
      settings.value = merged;
      applyToDOM(settings.value);
      return { success: true };
    } catch (err: any) {
      const msg = err.message || 'Failed to save settings';
      error.value = msg;
      return { success: false, error: msg };
    } finally {
      isLoading.value = false;
    }
  }

  return {
    settings,
    isLoading,
    error,
    loadSettings,
    saveSettings,
  };
}
