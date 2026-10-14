import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import NoteComposer from './NoteComposer.vue';

function clickOutside() {
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
}

describe('NoteComposer behavior', () => {
  it('expands with a title and toolbar on focus and collapses an empty draft on Close', async () => {
    const onSave = vi.fn();
    const wrapper = mount(NoteComposer, { props: { onSave } });
    const textarea = wrapper.get('textarea[aria-label="Write a note"]');

    expect(textarea.attributes('placeholder')).toBe('Take a note…');
    expect(wrapper.find('.composer-title').exists()).toBe(false);
    await textarea.trigger('focus');
    expect(wrapper.find('.composer-title').exists()).toBe(true);
    expect(wrapper.get('.composer-actions').isVisible()).toBe(true);

    await wrapper.get('.btn-close').trigger('click');
    await flushPromises();
    expect(onSave).not.toHaveBeenCalled();
    expect(wrapper.find('.composer-title').exists()).toBe(false);
  });

  it('saves trimmed content on Close, clears the composer, and emits created', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('.composer-textarea').setValue('  New note  ');
    await wrapper.get('.btn-close').trigger('click');
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('New note', []);
    expect(wrapper.emitted('created')).toHaveLength(1);
    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('');
  });

  it('stores the title as a leading markdown heading', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('.composer-textarea').trigger('focus');
    await wrapper.get('.composer-title').setValue('Groceries');
    await wrapper.get('.composer-textarea').setValue('milk');
    await wrapper.get('.btn-close').trigger('click');
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('# Groceries\n\nmilk', []);
  });

  it('saves the selected note color', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });

    await wrapper.get('.composer-textarea').trigger('focus');
    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Coral"]').trigger('click');
    await wrapper.get('.composer-textarea').setValue('Colored note');
    await wrapper.get('.btn-close').trigger('click');
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('Colored note', [], 'coral');
  });

  it('saves a draft when clicking outside, like Keep', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { attachTo: document.body, props: { onSave } });

    await wrapper.get('.composer-textarea').setValue('Outside save');
    clickOutside();
    await flushPromises();

    expect(onSave).toHaveBeenCalledWith('Outside save', []);
    wrapper.unmount();
  });

  it('collapses an empty composer when the palette closes outside', async () => {
    const onSave = vi.fn();
    const wrapper = mount(NoteComposer, { attachTo: document.body, props: { onSave } });

    await wrapper.get('.composer-textarea').trigger('focus');
    await wrapper.get('[title="Note color"]').trigger('click');
    expect(wrapper.get('.composer-actions').isVisible()).toBe(true);

    clickOutside();
    await flushPromises();
    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
    expect(wrapper.get('.composer-actions').isVisible()).toBe(false);
    expect(onSave).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('submits with Ctrl+Enter and saves on Escape', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave } });
    const textarea = wrapper.get('.composer-textarea');

    await textarea.setValue('Shortcut note');
    await textarea.trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(onSave).toHaveBeenLastCalledWith('Shortcut note', []);

    await textarea.setValue('Escape note');
    await textarea.trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(onSave).toHaveBeenLastCalledWith('Escape note', []);
    expect(wrapper.emitted('created')).toHaveLength(2);
  });

  it('consumes palette Escape first, then saves from its toolbar trigger on the next Escape', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { props: { onSave }, attachTo: document.body });
    await wrapper.get('textarea').setValue('Draft from the toolbar');
    await wrapper.get('button[aria-label="Note color"]').trigger('click');
    await flushPromises();
    await wrapper.get('[aria-label="Default"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(onSave).not.toHaveBeenCalled();
    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
    await wrapper.get('button[aria-label="Note color"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(onSave).toHaveBeenCalledOnce();
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value).toBe('');
    wrapper.unmount();
  });

  it('preserves content and stays open when the save fails', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: false, error: 'Try again' });
    const wrapper = mount(NoteComposer, { props: { onSave } });
    await wrapper.get('.composer-textarea').setValue('Keep this note');

    await wrapper.get('.btn-close').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Try again');
    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('Keep this note');
    expect(wrapper.get('.composer-actions').isVisible()).toBe(true);
    expect(wrapper.emitted('created')).toBeUndefined();
  });

  it('starts a checklist from the collapsed bar', async () => {
    const wrapper = mount(NoteComposer, { props: { onSave: vi.fn() } });

    await wrapper.get('[aria-label="New list"]').trigger('click');
    await flushPromises();

    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('- [ ] ');
    expect(wrapper.find('.composer-title').exists()).toBe(true);
    wrapper.unmount();
  });

  it('leaves focus where the outside click put it after the save finishes', async () => {
    let finish!: (value: { success: boolean }) => void;
    const onSave = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { finish = resolve; }));
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    const wrapper = mount(NoteComposer, { attachTo: document.body, props: { onSave } });

    await wrapper.get('.composer-textarea').setValue('Draft');
    elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    elsewhere.focus();
    finish({ success: true });
    await flushPromises();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(elsewhere);
    wrapper.unmount();
    elsewhere.remove();
  });

  it('ignores outside clicks while hidden in Archive or Trash', async () => {
    const onSave = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteComposer, { attachTo: document.body, props: { onSave } });

    await wrapper.get('.composer-textarea').setValue('Keep for later');
    await wrapper.setProps({ active: false });
    clickOutside();
    await flushPromises();

    expect(onSave).not.toHaveBeenCalled();
    expect((wrapper.get('.composer-textarea').element as HTMLTextAreaElement).value).toBe('Keep for later');
    wrapper.unmount();
  });
});
