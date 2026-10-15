import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import type { Thing } from '../api/client';
import NoteCard from './NoteCard.vue';
import * as markdown from '../utils/markdown';

function note(overrides: Partial<Thing> = {}): Thing {
  return {
    _id: 'note-1',
    ownerId: 'user-1',
    content: 'Hello **world**',
    richContent: '',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    revision: 1,
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
  it('copies through More, reports failures and disables repeat actions while copying', async () => {
    const thing = note();
    const onDuplicate = vi.fn().mockResolvedValue({ success: false, error: 'Copy failed' });
    const wrapper = mount(NoteCard, { props: { thing, onDuplicate }, attachTo: document.body });
    await wrapper.get('[aria-label="More note actions"]').trigger('click'); await flushPromises();
    (document.querySelector('[role="menuitem"][aria-label="Make a copy"]') as HTMLButtonElement).click(); await flushPromises();
    expect(onDuplicate).toHaveBeenCalledOnce(); expect(onDuplicate).toHaveBeenCalledWith(thing);
    expect(wrapper.emitted('openDetail')).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toBe('Copy failed');
    await wrapper.setProps({ duplicating: true });
    expect((wrapper.get('[aria-label="More note actions"]').element as HTMLButtonElement).disabled).toBe(true);
    expect(thing.content).toBe('Hello **world**');
    wrapper.unmount();
  });
  it('opens the detail dialog from a card click or Enter, but not from toolbar buttons', async () => {
    const thing = note();
    const onOpenDetail = vi.fn();
    const wrapper = mount(NoteCard, { props: { thing, onOpenDetail } });

    expect(wrapper.attributes('tabindex')).toBe('0');
    await wrapper.get('.card-body').trigger('click');
    await wrapper.trigger('keydown', { key: 'Enter' });
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
    expect(onOpenDetail).toHaveBeenCalledWith(thing);

    await wrapper.get('button[aria-label="Archive note"]').trigger('click');
    await wrapper.get('.card-pin-btn').trigger('click');
    expect(onOpenDetail).toHaveBeenCalledTimes(2);
  });

  it('updates highlighting without reparsing unchanged large notes', async () => {
    const render = vi.spyOn(markdown, 'renderMarkdown');
    const wrapper = mount(NoteCard, {
      props: { thing: note({ content: 'Hello world '.repeat(1500) }), highlightQuery: 'Hello' },
    });
    try {
      expect(render).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ highlightQuery: 'world' });
      expect(wrapper.get('mark').text()).toBe('world');
      expect(render).toHaveBeenCalledTimes(1);
      await wrapper.setProps({ thing: note({ content: '**Changed** world' }) });
      expect(render).toHaveBeenCalledTimes(2);
      expect(wrapper.get('strong').text()).toBe('Changed');
    } finally {
      wrapper.unmount();
      render.mockRestore();
    }
  });

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
    expect(wrapper.get('.card-pin-btn').attributes('aria-pressed')).toBe('true');
    expect(wrapper.find('.markdown-body strong').text()).toBe('world');
    expect(wrapper.findAll('.status-chip').map((chip) => chip.text())).toEqual(['Public', 'Shared']);
    expect(wrapper.find('.attachment-link').attributes('href')).toBe('/api/files/user-1/note-1/file-1');
    expect(wrapper.find('.attachment-size').text()).toBe('2.0 KB');
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

  it('emits the selected tag from its inline label chip', async () => {
    const wrapper = mount(NoteCard, {
      props: { thing: note({ content: 'Hello #work', richContent: 'Hello [#work](#search?#work)' }) },
    });

    await wrapper.get('a[href="#search?#work"]').trigger('click');

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
    ['Pin note', 'toggleSticky'],
    ['Make public', 'togglePublic'],
    ['Archive', 'toggleArchive'],
  ] as const)('emits %s action with the note', async (title, event) => {
    const thing = note();
    const wrapper = mount(NoteCard, { props: { thing } });

    if (event === 'togglePublic') {
      await wrapper.get('[aria-label="More note actions"]').trigger('click');
      await flushPromises();
      (document.querySelector('[role="menu"] [aria-label="Make public"]') as HTMLButtonElement).click();
      await flushPromises();
    } else await wrapper.get(`[title="${title}"]`).trigger('click');

    expect(wrapper.emitted(event)).toEqual([[thing]]);
  });

  it('emits delete immediately so the stream can offer Undo', async () => {
    const thing = note();
    const wrapper = mount(NoteCard, { props: { thing } });

    expect(document.querySelector('[role="menu"]')).toBeNull();
    await wrapper.get('[aria-label="More note actions"]').trigger('click');
    await flushPromises();
    (document.querySelector('[role="menu"] [aria-label="Delete note"]') as HTMLButtonElement).click();
    await flushPromises();

    expect(wrapper.emitted('delete')).toEqual([[thing]]);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it('hides mutating actions when editing is disabled', () => {
    const wrapper = mount(NoteCard, { props: { thing: note(), canEdit: false } });

    expect(wrapper.find('.card-actions').exists()).toBe(false);
  });

  it('toggles interactive checklist checkbox on click without opening the note', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: true });
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({ content: '- [ ] Buy groceries\n- [x] Read book' }),
        onSaveEdit,
      },
    });

    const checkboxes = wrapper.findAll('.task-list-item-checkbox');
    expect(checkboxes).toHaveLength(2);

    await checkboxes[0].trigger('click');
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledWith('note-1', {
      content: '- [x] Buy groceries\n- [x] Read book',
    });
    expect(wrapper.emitted('openDetail')).toBeUndefined();
  });

  it('emits imageClick when clicking an image in markdown or image attachment if listener provided', async () => {
    const onImageClick = vi.fn();
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({
          content: '![Diagram](/api/files/user-1/note-1/diagram.png)',
          attachments: [{ identifier: 'photo-1', fileName: 'sunset.jpg', size: 1024, type: 'image' }],
        }),
        onImageClick,
      },
    });

    const img = wrapper.find('.markdown-body img');
    expect(img.exists()).toBe(true);
    await img.trigger('click');

    expect(wrapper.emitted('imageClick')).toHaveLength(1);
    const eventPayload = wrapper.emitted('imageClick')![0] as [any[], number];
    expect(eventPayload[0]).toHaveLength(2);
    expect(eventPayload[1]).toBe(0);

    const attachmentLink = wrapper.find('.attachment-link');
    await attachmentLink.trigger('click');
    expect(wrapper.emitted('imageClick')).toHaveLength(2);
  });

  it('does not prevent default on attachment link if no onImageClick listener is bound', () => {
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({
          attachments: [{ identifier: 'photo-1', fileName: 'sunset.jpg', size: 1024, type: 'image' }],
        }),
      },
    });

    const attachmentLink = wrapper.find('.attachment-link');
    const clickEvent = new MouseEvent('click', { cancelable: true, bubbles: true });
    attachmentLink.element.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(false);
    expect(wrapper.emitted('imageClick')).toBeUndefined();
  });

  it('does not duplicate image attachments in markdown body when rendered as card images', () => {
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({
          content: '# Summer\n [sunset.jpg] \nSunny day!',
          richContent: '# Summer\n\n![/api/files/user-1/note-1/photo-1](/api/files/user-1/note-1/photo-1)\n\nSunny day!',
          attachments: [{ identifier: 'photo-1', fileName: 'sunset.jpg', size: 1024, type: 'image' }],
        }),
      },
    });

    // Renders the banner image at the top
    expect(wrapper.findAll('.card-images img')).toHaveLength(1);
    expect(wrapper.get('.card-images img').attributes('src')).toBe('/api/files/user-1/note-1/photo-1');

    // Does NOT render the duplicate image in the markdown body
    expect(wrapper.findAll('.card-body img')).toHaveLength(0);
    expect(wrapper.get('.card-body').text()).toContain('Summer');
    expect(wrapper.get('.card-body').text()).toContain('Sunny day!');

    // Overall exactly 1 image in the entire card
    expect(wrapper.findAll('img')).toHaveLength(1);
  });

  it('reverts checkbox state and shows error when task toggle save fails', async () => {
    const onSaveEdit = vi.fn().mockResolvedValue({ success: false, error: 'Task save failed' });
    const wrapper = mount(NoteCard, {
      props: {
        thing: note({ content: '- [ ] Todo' }),
        onSaveEdit,
      },
    });

    const checkbox = wrapper.find<HTMLInputElement>('.task-list-item-checkbox');
    expect(checkbox.element.checked).toBe(false);

    await checkbox.trigger('click');
    await flushPromises();

    expect(onSaveEdit).toHaveBeenCalledTimes(1);
    expect(checkbox.element.checked).toBe(false);
    expect(wrapper.get('.action-error').text()).toBe('Task save failed');
  });

  it('emits toggleSelect when selection button is clicked', async () => {
    const thing = note();
    const wrapper = mount(NoteCard, {
      props: {
        thing,
        selectable: true,
        selected: false,
      },
    });

    const selectBtn = wrapper.find('.card-select-btn');
    expect(selectBtn.exists()).toBe(true);
    expect(selectBtn.classes()).toContain('is-visible');

    await selectBtn.trigger('click');
    expect(wrapper.emitted('toggleSelect')).toEqual([[thing]]);
  });

  it('does not open detail when user was selecting text within the card', async () => {
    const thing = note({ content: 'Selectable text snippet' });
    const onOpenDetail = vi.fn();
    const wrapper = mount(NoteCard, { props: { thing, onOpenDetail } });

    vi.spyOn(window, 'getSelection').mockReturnValue({
      toString: () => 'Selectable',
    } as unknown as Selection);

    await wrapper.get('.card-body').trigger('click');
    expect(onOpenDetail).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('emits toggleSelect on long press and suppresses detail opening', async () => {
    vi.useFakeTimers();
    const thing = note();
    const onOpenDetail = vi.fn();
    const wrapper = mount(NoteCard, { props: { thing, onOpenDetail } });

    await wrapper.trigger('touchstart', {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    vi.advanceTimersByTime(500);

    expect(wrapper.emitted('toggleSelect')).toEqual([[thing]]);

    // Releasing finger and subsequent click should not open detail
    await wrapper.trigger('touchend');
    await wrapper.trigger('click');
    expect(onOpenDetail).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
