import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import NotesBatchBar from './NotesBatchBar.vue';

describe('NotesBatchBar', () => {
  it('preserves batch palette navigation, outside dismissal and Escape focus restoration', async () => {
    const wrapper = mount(NotesBatchBar, {
      props: { count: 2, total: 3, isBatchMutating: false, isArchived: false },
      attachTo: document.body,
    });
    try {
      const trigger = wrapper.get('[aria-label="Change color for selected notes"]');
      await trigger.trigger('click');
      await flushPromises();
      const swatches = wrapper.findAll('.batch-swatch');
      expect(document.activeElement).toBe(swatches[0].element);
      for (const [key, index] of [['End', swatches.length - 1], ['ArrowRight', 0], ['ArrowDown', 4], ['Home', 0]] as const) {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
        await flushPromises();
        expect(document.activeElement).toBe(swatches[index].element);
      }
      expect(wrapper.emitted('color')).toBeUndefined();
      await swatches[0].trigger('keydown', { key: 'Escape' });
      await flushPromises();
      expect(document.activeElement).toBe(trigger.element);
      expect(wrapper.find('.batch-color-palette').exists()).toBe(false);
      await trigger.trigger('click');
      await wrapper.get('.batch-color-palette [aria-label="Coral"]').trigger('click');
      expect(wrapper.emitted('color')).toEqual([['coral']]);
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      await flushPromises();
      expect(wrapper.find('.batch-color-palette').exists()).toBe(false);
      await trigger.trigger('click');
      await wrapper.setProps({ count: 0 });
      await flushPromises();
      await wrapper.setProps({ count: 2 });
      expect(wrapper.find('.batch-color-palette').exists()).toBe(false);
      await wrapper.get('.batch-text-btn').trigger('click');
      expect(wrapper.emitted('selectAll')).toHaveLength(1);
      await wrapper.setProps({ count: 3, isArchived: true });
      await wrapper.get('.batch-text-btn').trigger('click');
      expect(wrapper.emitted('clear')).toHaveLength(1);
      expect(wrapper.get('[aria-label="Restore selected notes"]').attributes('title')).toBe('Restore selected notes');
      await trigger.trigger('click');
      await wrapper.setProps({ isBatchMutating: true });
      for (const button of wrapper.findAll('button')) expect(button.element.disabled).toBe(true);
    } finally {
      wrapper.unmount();
    }
  });
});
