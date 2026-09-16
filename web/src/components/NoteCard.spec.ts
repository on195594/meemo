import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { Thing } from '../api/client';
import NoteCard from './NoteCard.vue';

function note(overrides: Partial<Thing> = {}): Thing {
  return {
    _id: 'note-1',
    ownerId: 'user-1',
    content: 'Hello **world**',
    richContent: '',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    tags: ['work'],
    attachments: [],
    public: false,
    shared: false,
    archived: false,
    sticky: false,
    ...overrides,
  };
}

describe('NoteCard behavior', () => {
  it('renders note state, markdown, and attachments', () => {
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({
          sticky: true,
          public: true,
          shared: true,
          archived: true,
          attachments: [{ identifier: 'file-1', fileName: 'report.pdf', size: 2048 }],
        }),
      },
    });

    expect(wrapper.classes()).toContain('is-sticky');
    expect(wrapper.classes()).toContain('is-archived');
    expect(wrapper.find('.markdown-body strong').text()).toBe('world');
    expect(wrapper.findAll('.badge')).toHaveLength(4);
    expect(wrapper.find('.attachment-link').attributes('href')).toBe('/api/files/user-1/note-1/file-1');
    expect(wrapper.find('.attachment-size').text()).toBe('(2.0 KB)');
  });

  it('uses the note color token for the card background', () => {
    const wrapper = mount(NoteCard, { props: { thing: note({ color: 'mint' }) } });

    expect(wrapper.attributes('style')).toContain('var(--note-color-mint)');
  });

  it('saves a selected color', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteCard, { props: { thing: note(), onSaveEdit } });

    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Coral"]').trigger('click');
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { color: 'coral' });
    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
  });

  it('keeps the color picker open and reports a failed color save', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: false, error: 'Color failed' });
    const wrapper = mount(NoteCard, { props: { thing: note(), onSaveEdit } });

    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Coral"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Color failed');
    expect(wrapper.find('.color-palette-popover').exists()).toBe(true);
    wrapper.unmount();
  });

  it('supports arrow navigation and Escape in the color picker', async () => {
    const wrapper = mount(NoteCard, {
      attachTo: document.body,
      props: { thing: note() },
    });

    const trigger = wrapper.get('[title="Note color"]');
    await trigger.trigger('click');
    await flushPromises();
    const defaultColor = wrapper.get('[aria-label="Default"]');
    expect(document.activeElement).toBe(defaultColor.element);

    await defaultColor.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();
    expect((document.activeElement as HTMLElement).getAttribute('aria-label')).toBe('Coral');
    expect(wrapper.emitted('update')).toBeUndefined();

    await wrapper.get('[aria-label="Coral"]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    wrapper.unmount();
  });

  it('saves only the color activated after keyboard navigation', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteCard, {
      attachTo: document.body,
      props: { thing: note(), onSaveEdit },
    });

    await wrapper.get('[title="Note color"]').trigger('click');
    await wrapper.get('[aria-label="Default"]').trigger('keydown', { key: 'ArrowRight' });
    await wrapper.get('[aria-label="Coral"]').trigger('keydown', { key: 'ArrowRight' });
    expect(onSaveEdit).not.toHaveBeenCalled();

    await wrapper.get('[aria-label="Peach"]').trigger('click');
    await flushPromises();
    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { color: 'peach' });
    wrapper.unmount();
  });

  it('closes the color picker on an outside pointer event', async () => {
    const wrapper = mount(NoteCard, {
      attachTo: document.body,
      props: { thing: note() },
    });

    await wrapper.get('[title="Note color"]').trigger('click');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('.color-palette-popover').exists()).toBe(false);
    wrapper.unmount();
  });

  it('emits the selected tag', async () => {
    const wrapper = mount(NoteCard, { props: { thing: note() } });

    await wrapper.get('.tag-pill').trigger('click');

    expect(wrapper.emitted('tagClick')).toEqual([['work']]);
  });

  it('emits wikilinkClick when a wikilink anchor inside markdown is clicked', async () => {
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({ content: 'See [[Target Note]] for details' }),
      },
    });

    const link = wrapper.find('.markdown-body a.wikilink');
    expect(link.exists()).toBe(true);
    expect(link.text()).toBe('Target Note');

    await link.trigger('click');
    expect(wrapper.emitted('wikilinkClick')).toEqual([['Target Note']]);
  });

  it('preserves native open in new tab when clicked with modifier keys', () => {
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({ content: 'See [[Target Note]] for details' }),
      },
    });

    const link = wrapper.find('.markdown-body a.wikilink');
    const ctrlClick = new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true });
    link.element.dispatchEvent(ctrlClick);
    expect(wrapper.emitted('wikilinkClick')).toBeUndefined();
    expect(ctrlClick.defaultPrevented).toBe(false);

    const middleClick = new MouseEvent('click', { button: 1, bubbles: true, cancelable: true });
    link.element.dispatchEvent(middleClick);
    expect(wrapper.emitted('wikilinkClick')).toBeUndefined();
    expect(middleClick.defaultPrevented).toBe(false);
  });

  it.each([
    ['Pin to top', 'toggleSticky'],
    ['Make public', 'togglePublic'],
    ['Archive note', 'toggleArchive'],
  ] as const)('emits %s action with the note', async (title, event) => {
    const thing = note();
    const wrapper = mount(NoteCard, { props: { thing } });

    await wrapper.get(`[title="${title}"]`).trigger('click');

    expect(wrapper.emitted(event)).toEqual([[thing]]);
  });

  it('saves trimmed edits and closes the editor', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteCard, { props: { thing: note(), onSaveEdit } });
    await wrapper.get('[title="Edit note"]').trigger('click');

    await wrapper.get('.edit-textarea').setValue('  Updated note  ');
    await wrapper.get('.btn-edit.primary').trigger('click');
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Updated note' });
    expect(wrapper.find('.inline-edit-form').exists()).toBe(false);
  });

  it('keeps a failed edit open and shows the error', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: false, error: 'Save failed' });
    const wrapper = mount(NoteCard, { props: { thing: note(), onSaveEdit } });
    await wrapper.get('[title="Edit note"]').trigger('click');

    await wrapper.get('.edit-textarea').setValue('Updated note');
    await wrapper.get('.btn-edit.primary').trigger('click');
    await flushPromises();

    expect(wrapper.get('[role="alert"]').text()).toBe('Save failed');
    expect(wrapper.find('.inline-edit-form').exists()).toBe(true);
  });

  it('confirms deletion through the provided callback', async () => {
    const onDeleteConfirm = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteCard, { props: { thing: note(), onDeleteConfirm } });

    await wrapper.get('[title="Delete note"]').trigger('click');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
    await wrapper.get('.confirm-delete').trigger('click');
    await flushPromises();

    expect(onDeleteConfirm).toHaveBeenCalledWith('note-1');
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('hides mutating actions when editing is disabled', () => {
    const wrapper = mount(NoteCard, { props: { thing: note(), canEdit: false } });

    expect(wrapper.find('.card-actions').exists()).toBe(false);
  });
});
