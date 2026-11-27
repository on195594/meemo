import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettings, setStoredTheme } from '../composables/useSettings';
import SettingsModal from './SettingsModal.vue';

vi.mock('../composables/useSettings', () => ({ useSettings: vi.fn(), getStoredTheme: vi.fn(() => 'auto'), setStoredTheme: vi.fn() }));
enableAutoUnmount(afterEach);
const wallpaper = 'data:image/png;base64,aGVsbG8=';
const initial = { title: 'My Notes', theme: 'dark' as const, wide: true, wideNavbar: false, publicBackground: true, keepPositionAfterEdit: true, backgroundImageDataUrl: wallpaper };
const saveSettings = vi.fn();
function render() {
  return mount(SettingsModal, { props: { modelValue: true }, global: { stubs: { RouterLink: true } } });
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useSettings).mockReturnValue({ settings: ref({ ...initial }), isLoading: ref(false), saveSettings } as unknown as ReturnType<typeof useSettings>);
  saveSettings.mockResolvedValue({ success: true });
});

describe('SettingsModal', () => {
  it('hydrates all visible form fields and wallpaper from settings', () => {
    const wrapper = render();
    expect((wrapper.get('#settings-title-input').element as HTMLInputElement).value).toBe('My Notes');
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('dark');
    expect(wrapper.findAll('input[type="checkbox"]').map(input => (input.element as HTMLInputElement).checked)).toEqual([true, false, true, true]);
    expect(wrapper.get('.image-picker-box').attributes('style')).toContain(wallpaper);
  });

  it('rejects wallpaper larger than 2MB and preserves the previous image', async () => {
    const wrapper = render();
    const file = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' });
    const input = wrapper.get('input[type="file"]');
    Object.defineProperty(input.element, 'files', { value: [file] });
    await input.trigger('change');
    expect(wrapper.get('[role="alert"]').text()).toContain('smaller than 2MB');
    expect(wrapper.get('.image-picker-box').attributes('style')).toContain(wallpaper);
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('clears wallpaper and saves the edited payload before closing', async () => {
    const wrapper = render();
    await wrapper.get('.btn-clear-bg').trigger('click');
    expect(wrapper.find('.btn-clear-bg').exists()).toBe(false);
    expect(wrapper.get('.image-picker-box').attributes('style') || '').not.toContain(wallpaper);
    await wrapper.get('#settings-title-input').setValue('  Updated  ');
    await wrapper.get('select').setValue('light');
    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(saveSettings).toHaveBeenCalledExactlyOnceWith({ ...initial, title: 'Updated', theme: 'light', wideNavbar: true, backgroundImageDataUrl: '' });
    expect(setStoredTheme).toHaveBeenCalledWith('light');
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
  });

  it('shows save errors without closing or discarding edits', async () => {
    saveSettings.mockResolvedValue({ success: false, error: 'Settings unavailable' });
    const wrapper = render();
    await wrapper.get('#settings-title-input').setValue('Unsaved');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Settings unavailable');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
    expect((wrapper.get('#settings-title-input').element as HTMLInputElement).value).toBe('Unsaved');
  });
});
