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

  it('emits the selected tag', async () => {
    const wrapper = mount(NoteCard, { props: { thing: note() } });

    await wrapper.get('.tag-pill').trigger('click');

    expect(wrapper.emitted('tagClick')).toEqual([['work']]);
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
