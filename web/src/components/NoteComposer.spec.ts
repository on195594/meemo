import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import NoteComposer from './NoteComposer.vue';

describe('NoteComposer behavior', () => {
  it('saves trimmed content, clears the composer, and emits created', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('.composer-textarea').setValue('  New note  ');
    await wrapper.get('.btn-composer.primary').trigger('click');
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('New note', []);
    expect(wrapper.emitted('created')).toHaveLength(1);
    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  it('saves the selected note color', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Coral"]').trigger('click');
    await wrapper.get('.composer-textarea').setValue('Colored note');
    await wrapper.get('.btn-composer.primary').trigger('click');
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('Colored note', [], 'coral');
  });

  it('resets the selected color when clearing a draft', async () => {
    const onSave = vi.fn();
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Coral"]').trigger('click');
    await wrapper.get('.composer-textarea').setValue('Discard me');
    await wrapper.get('.btn-composer.secondary').trigger('click');
    await wrapper.get('[title="Note color"]').trigger('click');

    expect(wrapper.get('[aria-label="Default"]').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  it('collapses an empty composer when the palette closes outside', async () => {
    const wrapper = mount(NoteComposer, {
      attachTo: document.body,
      props: { onSave: vi.fn() },
    });

    await wrapper.get('.composer-textarea').trigger('focus');
    await wrapper.get('[title="Note color"]').trigger('click');
    expect(wrapper.get('.composer-actions').isVisible()).toBe(true);

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();
    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
    expect(wrapper.get('.composer-actions').isVisible()).toBe(false);
    wrapper.unmount();
  });

  it('submits with Ctrl+Enter', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });
    const textarea = wrapper.get('.composer-textarea');
    await textarea.setValue('Shortcut note');

    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('Shortcut note', []);
    expect(wrapper.emitted('created')).toHaveLength(1);
  });

  it('preserves content and displays the save error', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Try again' });
    const wrapper = mount(NoteComposer, { props: { onSave } });
    await wrapper.get('.composer-textarea').setValue('Keep this note');

    await wrapper.get('.btn-composer.primary').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Try again');
    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('Keep this note');
    expect(wrapper.emitted('created')).toBeUndefined();
  });

  it('clears an in-progress note without saving it', async () => {
    const onSave = vi.fn();
    const wrapper = mount(NoteComposer, { props: { onSave } });
    await wrapper.get('.composer-textarea').setValue('Discard me');

    await wrapper.get('.btn-composer.secondary').trigger('click');

    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('');
    expect(onSave).not.toHaveBeenCalled();
  });
});
