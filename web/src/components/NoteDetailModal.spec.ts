import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Thing } from '../api/client';
import NoteDetailModal from './NoteDetailModal.vue';

function note(overrides: Partial<Thing> = {}): Thing {
  return {
    _id: 'note-1',
    ownerId: 'user-1',
    content: 'Hello **world**\n- [ ] Task 1\n- [x] Task 2',
    richContent: '',
    createdAt: 1700000000000,
    modifiedAt: 1700000000000,
    tags: ['work', 'project'],
    attachments: [
      { identifier: 'file-1', fileName: 'report.pdf', size: 2048 },
      { identifier: 'img-1', fileName: 'snapshot.png', size: 4096 },
    ],
    public: false,
    shared: false,
    archived: false,
    sticky: false,
    color: 'mint',
    ...overrides,
  };
}

describe('NoteDetailModal', () => {
  afterEach(() => {
    // Clean up any remaining teleported modals in document.body
    document.body.innerHTML = '';
    document.body.style.overflow = '';
  });

  it('does not render modal dialog when closed', () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: false,
        thing: note(),
      },
    });

    expect(document.querySelector('.note-modal-overlay')).toBeNull();
    wrapper.unmount();
  });

  it('renders note details, markdown, attachments, tags, and badges in view mode', () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note({ sticky: true, public: true }),
        initialMode: 'view',
      },
    });

    const overlay = document.querySelector('.note-modal-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute('aria-label')).toBe('Note details');

    // Badges & color
    expect(document.querySelector('.badge-sticky')?.textContent).toContain('Pinned');
    expect(document.querySelector('.badge-public')?.textContent).toContain('Public');
    const card = document.querySelector('.note-modal-card') as HTMLElement;
    expect(card.style.backgroundColor).toContain('var(--note-color-mint)');

    // Markdown rendered body
    const strong = document.querySelector('.markdown-body strong');
    expect(strong?.textContent).toBe('world');

    // Tags
    const tags = document.querySelectorAll('.tag-pill');
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toContain('#work');

    // Attachments
    const attachments = document.querySelectorAll('.attachment-card');
    expect(attachments).toHaveLength(2);
    expect(document.querySelector('.att-name')?.textContent).toBe('report.pdf');

    // Body scroll locked
    expect(document.body.style.overflow).toBe('hidden');

    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('switches between view mode and edit mode', async () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'view',
      },
    });

    expect(document.querySelector('.modal-textarea')).toBeNull();

    // Click edit mode button
    const editBtn = document.querySelector('[title="Edit markdown"]') as HTMLButtonElement;
    expect(editBtn).not.toBeNull();
    editBtn.click();
    await flushPromises();

    // Now textarea should appear
    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(textarea.value).toContain('Hello **world**');

    // Click preview mode button to switch back
    const previewBtn = document.querySelector('[title="View formatted markdown"]') as HTMLButtonElement;
    expect(previewBtn).not.toBeNull();
    previewBtn.click();
    await flushPromises();

    expect(document.querySelector('.modal-textarea')).toBeNull();
    expect(document.querySelector('.modal-markdown-body')).not.toBeNull();

    wrapper.unmount();
  });

  it('auto-saves modified draft and closes when Close button is clicked', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'edit',
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Updated note content';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    const closeBtn = document.querySelector('.done-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Updated note content' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('closes without saving if content was not changed', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'view',
        onSaveEdit,
      },
    });

    const closeBtn = document.querySelector('.done-btn') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();
    await flushPromises();

    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('auto-saves and closes when backdrop is clicked', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'edit',
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Backdrop save content';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    const overlay = document.querySelector('.note-modal-overlay') as HTMLElement;
    overlay.click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Backdrop save content' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('auto-saves and closes on Escape key press', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'edit',
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Escape save content';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Escape save content' });
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('saves with Ctrl+S without closing the modal', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'edit',
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Ctrl+S saved content';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Ctrl+S saved content' });
    expect(wrapper.emitted('close')).toBeUndefined();

    wrapper.unmount();
  });

  it('keeps modal open when auto-save fails on close', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: false, error: 'Network error' });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        initialMode: 'edit',
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Failing save content';
    textarea.dispatchEvent(new Event('input'));
    await flushPromises();

    const closeBtn = document.querySelector('.done-btn') as HTMLButtonElement;
    closeBtn.click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Failing save content' });
    // Modal stays open when save fails
    expect(wrapper.emitted('close')).toBeUndefined();

    wrapper.unmount();
  });

  it('toggles pin, public, and archive states', async () => {
    const onToggleSticky = vi.fn();
    const onTogglePublic = vi.fn();
    const onToggleArchive = vi.fn();

    const current = note();
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: current,
        onToggleSticky,
        onTogglePublic,
        onToggleArchive,
      },
    });

    // Pin button in header
    const pinBtn = document.querySelector('.pin-btn') as HTMLButtonElement;
    expect(pinBtn).not.toBeNull();
    pinBtn.click();
    expect(onToggleSticky).toHaveBeenCalledWith(current);

    // Public toggle in footer
    const publicBtn = document.querySelector('[title="Make note public"]') as HTMLButtonElement;
    expect(publicBtn).not.toBeNull();
    publicBtn.click();
    expect(onTogglePublic).toHaveBeenCalledWith(current);

    // Archive toggle in footer
    const archiveBtn = document.querySelector('[title="Archive note"]') as HTMLButtonElement;
    expect(archiveBtn).not.toBeNull();
    archiveBtn.click();
    expect(onToggleArchive).toHaveBeenCalledWith(current);

    wrapper.unmount();
  });

  it('prioritizes stream action events to trigger toasts even when onSaveEdit is provided', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const onToggleSticky = vi.fn();
    const current = note();

    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: current,
        onSaveEdit,
        onToggleSticky,
      },
    });

    const pinBtn = document.querySelector('.pin-btn') as HTMLButtonElement;
    expect(pinBtn).not.toBeNull();
    pinBtn.click();

    expect(onToggleSticky).toHaveBeenCalledWith(current);
    expect(onSaveEdit).not.toHaveBeenCalled();

    wrapper.unmount();
  });

  it('cleans up color picker when modal closes', async () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
      },
    });

    const colorTrigger = document.querySelector('.color-btn') as HTMLButtonElement;
    colorTrigger.click();
    await flushPromises();

    expect(document.querySelector('.color-palette-popover')).not.toBeNull();

    await wrapper.setProps({ open: false });
    await flushPromises();

    expect(document.querySelector('.color-palette-popover')).toBeNull();

    wrapper.unmount();
  });

  it('changes and saves note color via palette popover', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const current = note({ color: 'default' });

    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: current,
        onSaveEdit,
      },
    });

    const colorTrigger = document.querySelector('.color-btn') as HTMLButtonElement;
    expect(colorTrigger).not.toBeNull();
    colorTrigger.click();
    await flushPromises();

    const coralBtn = document.querySelector('[aria-label="Coral"]') as HTMLButtonElement;
    expect(coralBtn).not.toBeNull();
    coralBtn.click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { color: 'coral' });

    wrapper.unmount();
  });

  it('handles delete flow with confirmation modal', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        onDelete,
      },
    });

    // Click trash button
    const deleteBtn = document.querySelector('.delete-btn') as HTMLButtonElement;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();
    await flushPromises();

    // Confirm dialog overlay should appear
    const confirmOverlay = document.querySelector('.delete-confirm-overlay');
    expect(confirmOverlay).not.toBeNull();

    // Click confirm
    const confirmBtn = document.querySelector('.btn-delete') as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await flushPromises();

    expect(onDelete).toHaveBeenCalledWith('note-1');
    expect(wrapper.emitted('close')).toHaveLength(1);

    wrapper.unmount();
  });

  it('renders read-only view when canEdit is false', () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        canEdit: false,
      },
    });

    // No edit toggle button
    expect(document.querySelector('.mode-toggle-group')).toBeNull();
    // No pin, color, public, archive, delete buttons
    expect(document.querySelector('.pin-btn')).toBeNull();
    expect(document.querySelector('.color-btn')).toBeNull();
    expect(document.querySelector('.delete-btn')).toBeNull();

    wrapper.unmount();
  });
});
