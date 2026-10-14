import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  settings: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock('../api/client', () => ({
  api: apiMock,
}));

import { resetSettingsState, useSettings } from './useSettings';

const WALLPAPER = 'data:image/png;base64,iVBORw0KGgo=';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useSettings theme and wallpaper DOM state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    apiMock.settings.save.mockResolvedValue({});
    apiMock.settings.get.mockResolvedValue({ settings: {} });
    resetSettingsState();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
  });

  it.each([
    { theme: 'dark', attr: 'dark', colorScheme: 'dark' },
    { theme: 'light', attr: 'light', colorScheme: 'light' },
    { theme: 'auto', attr: null, colorScheme: '' },
  ] as const)('applies $theme to the document root', async ({ theme, attr, colorScheme }) => {
    const { saveSettings } = useSettings();

    const result = await saveSettings({ theme });

    expect(result.success).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe(attr);
    expect(document.documentElement.style.colorScheme).toBe(colorScheme);
    expect(localStorage.getItem('meemo_theme')).toBe(theme);
  });

  it('adds the custom-background class and wallpaper style only while a wallpaper is set', async () => {
    const { saveSettings } = useSettings();

    await saveSettings({ backgroundImageDataUrl: WALLPAPER });
    expect(document.body.classList.contains('has-custom-bg')).toBe(true);
    expect(document.body.style.backgroundImage).toContain('data:image/png;base64,iVBORw0KGgo=');
    expect(document.body.style.backgroundSize).toBe('cover');
    expect(document.body.style.backgroundAttachment).toBe('fixed');

    await saveSettings({ backgroundImageDataUrl: '' });
    expect(document.body.classList.contains('has-custom-bg')).toBe(false);
    expect(document.body.style.backgroundImage).toBe('');
  });

  it('sends the merged settings, including the wallpaper and theme, to the server', async () => {
    const { saveSettings } = useSettings();

    await saveSettings({ theme: 'dark', backgroundImageDataUrl: WALLPAPER });

    expect(apiMock.settings.save).toHaveBeenCalledWith(
      expect.objectContaining({ theme: 'dark', backgroundImageDataUrl: WALLPAPER, title: 'Meemo' }),
    );
  });

  it('lets the server theme override the device theme on load', async () => {
    localStorage.setItem('meemo_theme', 'light');
    apiMock.settings.get.mockResolvedValue({ settings: { theme: 'dark' } });
    const { loadSettings } = useSettings();

    const loaded = await loadSettings();

    expect(loaded.theme).toBe('dark');
    expect(localStorage.getItem('meemo_theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('keeps the device theme when the server has no theme, and restores wallpaper on load', async () => {
    localStorage.setItem('meemo_theme', 'light');
    apiMock.settings.get.mockResolvedValue({ settings: { backgroundImageDataUrl: WALLPAPER } });
    const { loadSettings } = useSettings();

    const loaded = await loadSettings();

    expect(loaded.theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.body.classList.contains('has-custom-bg')).toBe(true);
  });

  it('resets wallpaper and user settings but keeps the device theme', async () => {
    const { saveSettings, settings } = useSettings();
    await saveSettings({ theme: 'dark', backgroundImageDataUrl: WALLPAPER, title: 'Mine' });

    resetSettingsState();

    expect(settings.value.backgroundImageDataUrl).toBe('');
    expect(settings.value.title).toBe('Meemo');
    expect(settings.value.theme).toBe('dark');
    expect(document.body.classList.contains('has-custom-bg')).toBe(false);
    expect(document.body.style.backgroundImage).toBe('');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('meemo_theme')).toBe('dark');
  });

  it('does not re-apply a wallpaper from a load that started before a reset', async () => {
    const pending = deferred<{ settings: Record<string, unknown> }>();
    apiMock.settings.get.mockReturnValue(pending.promise);
    const { loadSettings } = useSettings();

    const loading = loadSettings();
    resetSettingsState();
    pending.resolve({ settings: { backgroundImageDataUrl: WALLPAPER } });
    await loading;

    expect(document.body.classList.contains('has-custom-bg')).toBe(false);
    expect(document.body.style.backgroundImage).toBe('');
  });

  it('does not apply a stale save result after a reset', async () => {
    const pending = deferred<object>();
    apiMock.settings.save.mockReturnValue(pending.promise);
    const { saveSettings, settings } = useSettings();

    const saving = saveSettings({ backgroundImageDataUrl: WALLPAPER });
    resetSettingsState();
    pending.resolve({});
    const result = await saving;

    expect(result).toEqual({ success: false, error: 'Session changed' });
    expect(settings.value.backgroundImageDataUrl).toBe('');
    expect(document.body.classList.contains('has-custom-bg')).toBe(false);
  });
});
