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
    revision: 1,
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

async function openMoreMenu() {
  (document.querySelector('.note-modal-card [aria-label="More note actions"]') as HTMLButtonElement).click();
  await flushPromises();
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

  it('opens straight into Keep-style editing with attachments and status', () => {
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note({ sticky: true, public: true }),
      },
    });

    const overlay = document.querySelector('.note-modal-overlay');
    expect(overlay?.getAttribute('aria-label')).toBe('Edit note');
    const card = document.querySelector('.note-modal-card') as HTMLElement;
    expect(card.style.backgroundColor).toContain('var(--note-color-mint)');

    expect((document.querySelector('.modal-title-input') as HTMLInputElement).value).toBe('');
    expect((document.querySelector('.modal-textarea') as HTMLTextAreaElement).value).toContain('Hello **world**');
    expect(document.querySelector('.mode-toggle-group')).toBeNull();
    expect(document.querySelector('.pin-btn')?.getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.status-chip')?.textContent).toContain('Public');

    expect(document.querySelectorAll('.modal-images img')).toHaveLength(1);
    expect(document.querySelectorAll('.attachment-anchor')).toHaveLength(1);
    expect(document.querySelector('.att-name')?.textContent).toBe('report.pdf');

    expect(document.body.style.overflow).toBe('hidden');
    wrapper.unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('edits the leading heading as a separate title and saves it back as markdown', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: { open: true, thing: note({ content: '# Trip\n\nDay 1' }), onSaveEdit },
    });

    const title = document.querySelector('.modal-title-input') as HTMLInputElement;
    expect(title.value).toBe('Trip');
    expect((document.querySelector('.modal-textarea') as HTMLTextAreaElement).value).toBe('Day 1');

    title.value = 'Trip 2';
    title.dispatchEvent(new Event('input'));
    (document.querySelector('.done-btn') as HTMLButtonElement).click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: '# Trip 2\n\nDay 1' });
    wrapper.unmount();
  });

  it('keeps body indentation when only the title changes and treats whitespace edits as changes', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: { open: true, thing: note({ content: '# Code\n\n    const answer = 42;' }), onSaveEdit },
    });

    const body = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    expect(body.value).toBe('    const answer = 42;');
    body.value = '        const answer = 42;';
    body.dispatchEvent(new Event('input'));
    (document.querySelector('.done-btn') as HTMLButtonElement).click();
    await flushPromises();
    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: '# Code\n\n        const answer = 42;' });
    wrapper.unmount();
  });

  it('shows a Setext heading in read-only notes because it is not split into the title', () => {
    const wrapper = mount(NoteDetailModal, {
      props: { open: true, thing: note({ content: 'Heading\n===\n\nbody' }), canEdit: false },
    });

    expect(document.querySelector('.modal-markdown-body')?.classList.contains('has-split-title')).toBe(false);
    expect(document.querySelector('.modal-markdown-body h1')?.textContent).toBe('Heading');
    wrapper.unmount();
  });

  it('does not rewrite a note whose title spacing merely differs from the canonical form', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: { open: true, thing: note({ content: '# Trip\nDay 1' }), onSaveEdit },
    });

    (document.querySelector('.done-btn') as HTMLButtonElement).click();
    await flushPromises();

    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('auto-saves modified draft and closes when Close button is clicked', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
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

  it.each(['shortcut', 'Close', 'Escape', 'backdrop'])('keeps newer input when an older %s save resolves', async (action) => {
    let resolveSave!: (value: { success: boolean; thing: Thing }) => void;
    const onSaveEdit = vi.fn(() => new Promise<{ success: boolean; thing: Thing }>((resolve) => {
      resolveSave = resolve;
    }));
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
        onSaveEdit,
      },
    });

    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Saved A';
    textarea.dispatchEvent(new Event('input'));
    if (action === 'shortcut') textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
    else if (action === 'Close') (document.querySelector('.done-btn') as HTMLButtonElement).click();
    else if (action === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    else (document.querySelector('.note-modal-overlay') as HTMLElement).click();
    await flushPromises();

    textarea.value = 'Newer B';
    textarea.dispatchEvent(new Event('input'));
    resolveSave({ success: true, thing: note({ content: 'Saved A', revision: 2 }) });
    await flushPromises();

    expect(textarea.value).toBe('Newer B');
    expect(wrapper.emitted('close')).toBeUndefined();

    onSaveEdit.mockResolvedValueOnce({ success: true, thing: note({ content: 'Newer B', revision: 3 }) });
    (document.querySelector('.done-btn') as HTMLButtonElement).click();
    await flushPromises();
    expect(onSaveEdit).toHaveBeenLastCalledWith('note-1', { content: 'Newer B' });
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it.each(['Archive note', 'Move note to trash'])('does not run %s when saving its draft fails', async (action) => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: false, error: 'Synthetic failure' });
    const wrapper = mount(NoteDetailModal, {
      props: { open: true, thing: note(), onSaveEdit, onToggleArchive: vi.fn() },
    });
    const textarea = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    textarea.value = 'Draft before action';
    textarea.dispatchEvent(new Event('input'));
    if (action === 'Move note to trash') await openMoreMenu();
    (document.querySelector(`[aria-label="${action}"]`) as HTMLButtonElement).click();
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', { content: 'Draft before action' });
    expect(wrapper.emitted('delete')).toBeUndefined();
    expect(wrapper.emitted('toggleArchive')).toBeUndefined();
    expect(textarea.value).toBe('Draft before action');
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Synthetic failure');
    wrapper.unmount();
  });

  it('closes without saving if content was not changed', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: note(),
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
    await openMoreMenu();
    const publicBtn = document.querySelector('[aria-label="Make note public"]') as HTMLButtonElement;
    expect(publicBtn).not.toBeNull();
    publicBtn.click();
    expect(onTogglePublic).toHaveBeenCalledWith(current);

    // Archive toggle in footer
    const archiveBtn = document.querySelector('[aria-label="Archive note"]') as HTMLButtonElement;
    expect(archiveBtn).not.toBeNull();
    archiveBtn.click();
    await flushPromises();
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

  it.each(['More note actions', 'Note color'])('closes only %s on Escape without saving or losing a dialog draft', async (action) => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteDetailModal, { props: { open: true, thing: note(), onSaveEdit } });
    const body = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    body.value = 'Draft while browsing actions';
    body.dispatchEvent(new Event('input'));
    if (action === 'More note actions') await openMoreMenu();
    else {
      (document.querySelector('.note-modal-card [aria-label="Note color"]') as HTMLButtonElement).click();
      await flushPromises();
    }
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flushPromises();
    expect(document.querySelector('[role="menu"], .color-palette-popover')).toBeNull();
    expect(wrapper.emitted('close')).toBeUndefined();
    expect(onSaveEdit).not.toHaveBeenCalled();
    expect(body.value).toBe('Draft while browsing actions');
    expect(document.activeElement?.getAttribute('aria-label')).toBe(action);
    wrapper.unmount();
  });

  it('emits delete without a confirmation dialog', async () => {
    const current = note();
    const wrapper = mount(NoteDetailModal, {
      props: {
        open: true,
        thing: current,
      },
    });

    await openMoreMenu();
    (document.querySelector('.delete-btn') as HTMLButtonElement).click();
    await flushPromises();

    expect(document.querySelector('.delete-confirm-overlay')).toBeNull();
    expect(wrapper.emitted('delete')).toEqual([[current]]);

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

    // Rendered markdown instead of an editor
    expect(document.querySelector('.modal-textarea')).toBeNull();
    expect(document.querySelector('.markdown-body strong')?.textContent).toBe('world');
    // No pin, color, public, archive, delete buttons
    expect(document.querySelector('.pin-btn')).toBeNull();
    expect(document.querySelector('.color-btn')).toBeNull();
    expect(document.querySelector('.delete-btn')).toBeNull();

    wrapper.unmount();
  });
});
