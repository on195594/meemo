import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NoteColorPopover from './NoteColorPopover.vue';
import { NOTE_COLORS } from '../constants/noteColors';

describe('NoteColorPopover', () => {
  it('keeps navigation separate from activation, wraps in four columns, and restores the selected focus on reopen', async () => {
    const wrapper = mount(NoteColorPopover, {
      props: { open: false, id: 'colors', color: 'mint', label: 'Note card color', anchor: null, wrapper: null, disabled: false },
      attachTo: document.body,
    });
    try {
      await wrapper.setProps({ open: true });
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[aria-label="Mint"]').element);
      expect(wrapper.get('[role="group"]').attributes('aria-label')).toBe('Note card color');
      expect(wrapper.get('[aria-label="Default"]').classes()).toContain('is-default');
      expect(wrapper.get('[aria-label="Mint"]').attributes('aria-pressed')).toBe('true');
      expect(wrapper.get('[aria-label="Mint"]').attributes('aria-disabled')).toBeUndefined();
      for (const [key, index] of [['Home', 0], ['ArrowLeft', NOTE_COLORS.length - 1], ['ArrowRight', 0], ['ArrowDown', 4], ['ArrowUp', 0], ['End', NOTE_COLORS.length - 1]] as const) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(document.activeElement).toBe(wrapper.findAll('.color-swatch-btn')[index].element);
      }
      expect(wrapper.emitted('select')).toBeUndefined();
      expect(wrapper.emitted('navigate')).toHaveLength(6);
      await wrapper.get('[aria-label="Coral"]').trigger('click');
      expect(wrapper.emitted('select')).toEqual([['coral']]);
      await wrapper.setProps({ open: false });
      await wrapper.setProps({ open: true });
      await flushPromises();
      expect(document.activeElement).toBe(wrapper.get('[aria-label="Mint"]').element);
      await wrapper.get('[aria-label="Mint"]').trigger('keydown', { key: 'Escape' });
      expect(wrapper.emitted('close')).toEqual([[true]]);
    } finally {
      wrapper.unmount();
    }
  });

  it('keeps a teleported panel interactive, ignores disabled activation, and returns focus before modal Tab dismissal', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    const wrapper = mount(NoteColorPopover, {
      props: { open: false, id: 'colors', color: 'default', label: 'Note modal color', anchor, wrapper: anchor, modal: true, disabled: true },
      attachTo: document.body,
    });
    try {
      await wrapper.setProps({ open: true });
      await flushPromises();
      const swatch = wrapper.get('[aria-label="Coral"]');
      await swatch.trigger('pointerdown');
      await swatch.trigger('click');
      expect(swatch.attributes('aria-disabled')).toBe('true');
      expect(wrapper.emitted('select')).toBeUndefined();
      expect(wrapper.emitted('close')).toBeUndefined();
      await swatch.trigger('keydown', { key: 'Tab' });
      expect(document.activeElement).toBe(anchor);
      expect(wrapper.emitted('close')).toEqual([[]]);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(wrapper.emitted('close')).toHaveLength(2);
      document.body.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      expect(wrapper.emitted('close')).toHaveLength(3);
    } finally {
      wrapper.unmount();
      anchor.remove();
    }
  });

  it('mounts with open=true immediately and preserves non-modal Tab without closing', async () => {
    const wrapper = mount(NoteColorPopover, {
      props: { open: true, id: 'colors', color: 'default', label: 'Color', anchor: null, wrapper: null },
      attachTo: document.body,
    });
    try {
      await flushPromises();
      await wrapper.get('[aria-label="Default"]').trigger('keydown', { key: 'Tab' });
      expect(wrapper.emitted('close')).toBeUndefined();
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(wrapper.emitted('close')).toEqual([[]]);
    } finally {
      wrapper.unmount();
    }
  });
});
