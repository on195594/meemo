import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  tags: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../api/client', () => ({
  api: {
    things: apiMock,
  },
}));

import { resetNotesState, useNotes } from './useNotes';
import type { Thing } from '../api/client';

function note(id: string, overrides: Record<string, unknown> = {}): Thing {
  return {
    _id: id,
    content: `note ${id}`,
    attachments: [],
    tags: [],
    public: false,
    shared: false,
    archived: false,
    sticky: false,
    createdAt: 1,
    modifiedAt: 1,
    ...overrides,
  } as unknown as Thing;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe('useNotes behavior', () => {
  beforeEach(() => {
    resetNotesState();
    vi.resetAllMocks();
    apiMock.tags.mockResolvedValue({ tags: [] });
  });

  it('loads notes from the current route-owned filters', async () => {
    apiMock.list.mockResolvedValue({ things: [note('filtered')] });
    const store = useNotes();

    await store.setFilters({ search: 'ignored while tagged', tag: 'work', archived: true });

    expect(apiMock.list).toHaveBeenCalledWith({
      filter: '#work',
      archived: true,
      skip: 0,
      limit: 15,
    });
    expect(store.things.value.map((thing) => thing._id)).toEqual(['filtered']);
  });

  it('resets all user-scoped note state', async () => {
    apiMock.list.mockResolvedValue({ things: [note('user-a')] });
    apiMock.tags.mockResolvedValue({ tags: [{ name: 'private', usage: 1 }] });
    const store = useNotes();
    await store.setFilters({ search: 'secret', tag: null, archived: true });
    await store.fetchTags();

    store.reset();

    expect(store.things.value).toEqual([]);
    expect(store.tags.value).toEqual([]);
    expect(store.searchQuery.value).toBe('');
    expect(store.selectedTag.value).toBeNull();
    expect(store.isArchived.value).toBe(false);
    expect(store.error.value).toBeNull();
  });

  it('ignores a stale list response after the user state resets', async () => {
    const pending = deferred<{ things: ReturnType<typeof note>[] }>();
    apiMock.list.mockReturnValue(pending.promise);
    const store = useNotes();

    const request = store.fetchNotes();
    store.reset();
    pending.resolve({ things: [note('user-a')] });
    await request;

    expect(store.things.value).toEqual([]);
    expect(store.isLoading.value).toBe(false);
  });

  it('creates a trimmed note in the visible list', async () => {
    const created = note('new');
    apiMock.create.mockResolvedValue({ thing: created });
    const store = useNotes();

    const result = await store.createNote('  new note  ');

    expect(apiMock.create).toHaveBeenCalledWith({ content: 'new note', attachments: [] });
    expect(result).toEqual({ success: true, thing: created });
    expect(store.things.value).toEqual([created]);
  });

  it('updates content and public state', async () => {
    const original = note('one');
    const updated = note('one', { content: 'edited', public: true, modifiedAt: 2 });
    apiMock.list.mockResolvedValue({ things: [original] });
    apiMock.update.mockResolvedValue({ thing: updated });
    const store = useNotes();
    await store.fetchNotes();

    await store.updateNote('one', { content: ' edited ', public: true });

    expect(apiMock.update).toHaveBeenCalledWith('one', expect.objectContaining({
      content: 'edited',
      public: true,
    }));
    expect(store.things.value).toEqual([updated]);
  });

  it('reorders the visible list after a color update changes modifiedAt', async () => {
    const first = note('first', { modifiedAt: 3 });
    const second = note('second', { modifiedAt: 2, color: 'default' });
    apiMock.list.mockResolvedValue({ things: [first, second] });
    apiMock.update.mockResolvedValue({ thing: { ...second, color: 'mint', modifiedAt: 4 } });
    const store = useNotes();
    await store.fetchNotes();

    await store.updateNote('second', { color: 'mint' });

    expect(apiMock.update).toHaveBeenCalledWith('second', expect.objectContaining({ color: 'mint' }));
    expect(store.things.value.map((thing) => thing._id)).toEqual(['second', 'first']);
  });

  it('moves sticky notes first and removes archived notes from the active view', async () => {
    const first = note('first', { modifiedAt: 3 });
    const second = note('second', { modifiedAt: 2 });
    apiMock.list.mockResolvedValue({ things: [first, second] });
    const store = useNotes();
    await store.fetchNotes();

    const sticky = note('second', { sticky: true, modifiedAt: 4 });
    apiMock.update.mockResolvedValueOnce({ thing: sticky });
    await store.toggleSticky(second);
    expect(store.things.value.map((thing) => thing._id)).toEqual(['second', 'first']);

    apiMock.update.mockResolvedValueOnce({ thing: { ...sticky, archived: true } });
    await store.toggleArchive(sticky);
    expect(store.things.value.map((thing) => thing._id)).toEqual(['first']);
  });

  it('deletes a note from the visible list', async () => {
    apiMock.list.mockResolvedValue({ things: [note('keep'), note('delete')] });
    apiMock.delete.mockResolvedValue(undefined);
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.deleteNote('delete');

    expect(result).toEqual({ success: true });
    expect(apiMock.delete).toHaveBeenCalledWith('delete');
    expect(store.things.value.map((thing) => thing._id)).toEqual(['keep']);
  });

  it('batch updates multiple notes', async () => {
    const n1 = note('n1', { color: 'default' });
    const n2 = note('n2', { color: 'default' });
    apiMock.list.mockResolvedValue({ things: [n1, n2] });
    apiMock.update.mockImplementation((id, payload) =>
      Promise.resolve({ thing: note(id, payload) })
    );
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.batchUpdateNotes(['n1', 'n2'], { color: 'coral' });
    expect(result.success).toBe(true);
    expect(result.updatedCount).toBe(2);
    expect(apiMock.update).toHaveBeenCalledTimes(2);
    expect(store.things.value.every((t) => t.color === 'coral')).toBe(true);
  });

  it('batch deletes multiple notes', async () => {
    const n1 = note('n1');
    const n2 = note('n2');
    const n3 = note('n3');
    apiMock.list.mockResolvedValue({ things: [n1, n2, n3] });
    apiMock.delete.mockResolvedValue(undefined);
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.batchDeleteNotes(['n1', 'n2']);
    expect(result.success).toBe(true);
    expect(result.deletedCount).toBe(2);
    expect(apiMock.delete).toHaveBeenCalledTimes(2);
    expect(store.things.value.map((t) => t._id)).toEqual(['n3']);
  });
});
