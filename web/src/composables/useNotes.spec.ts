import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';

const apiMock = vi.hoisted(() => ({
  list: vi.fn(),
  tags: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  restore: vi.fn(),
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
    revision: 1,
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

  it.each([
    [new TypeError('Failed to fetch'), true],
    [{ status: 503, message: 'Unavailable' }, true],
    [{ status: 401, message: 'Unauthorized' }, false],
    [{ status: 400, message: 'Invalid request' }, false],
    [{ status: 409, code: 'revision_conflict', message: 'Conflict' }, false],
  ])('marks only transient update errors as retryable (%j)', async (failure, retryable) => {
    const store = useNotes();
    store.things.value = [note('one')];
    apiMock.update.mockRejectedValue(failure);
    apiMock.get.mockRejectedValue(failure);
    const result = await store.updateNote('one', { content: 'changed' });
    expect(result).toMatchObject({ success: false, retryable });
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

  it.each(['create', 'delete'] as const)('restarts pagination after a local %s without duplicate or missing notes', async (mutation) => {
    const remote = Array.from({ length: 31 }, (_, i) => note(String(i)));
    apiMock.list.mockImplementation(async ({ skip, limit }) => ({ things: remote.slice(skip, skip + limit) }));
    const store = useNotes();
    await store.fetchNotes();
    if (mutation === 'create') {
      const created = note('new', { modifiedAt: 2 });
      remote.unshift(created);
      apiMock.create.mockResolvedValue({ thing: created });
      await store.createNote(created.content);
    } else {
      remote.splice(3, 1);
      apiMock.delete.mockResolvedValue({});
      await store.deleteNote('3');
    }

    await store.fetchMore();
    expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));
    for (let i = 0; i < 4 && store.hasMore.value; i++) await store.fetchMore();
    expect(store.things.value.map(t => t._id)).toEqual(remote.map(t => t._id));
  });

  it('retries a failed pagination rebuild as a replacement, not an append', async () => {
    const initial = Array.from({ length: 15 }, (_, i) => note(String(i)));
    apiMock.list.mockResolvedValueOnce({ things: initial });
    const store = useNotes();
    await store.fetchNotes();
    apiMock.create.mockResolvedValue({ thing: note('new', { modifiedAt: 2 }) });
    await store.createNote('new');
    apiMock.list.mockRejectedValueOnce(new TypeError('Offline'));
    await store.fetchMore();
    apiMock.list.mockResolvedValueOnce({ things: [note('server-only')] });
    await store.fetchMore();
    expect(store.things.value.map(t => t._id)).toEqual(['server-only']);
    expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0 }));
  });

  it('deduplicates overlapping pages but advances by the raw server page size', async () => {
    const first = Array.from({ length: 15 }, (_, i) => note(String(i)));
    const overlap = Array.from({ length: 15 }, (_, i) => note(String(i + 14)));
    apiMock.list.mockResolvedValueOnce({ things: first }).mockResolvedValueOnce({ things: overlap }).mockResolvedValueOnce({ things: [] });
    const store = useNotes();
    await store.fetchNotes();
    await store.fetchMore();
    expect(store.things.value).toHaveLength(29);
    expect(new Set(store.things.value.map(t => t._id)).size).toBe(29);
    await store.fetchMore();
    expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 30 }));
  });

  it('ignores a pending pagination response superseded by a local mutation', async () => {
    const first = Array.from({ length: 15 }, (_, i) => note(String(i)));
    const pending = deferred<{ things: Thing[] }>();
    apiMock.list.mockResolvedValueOnce({ things: first }).mockReturnValueOnce(pending.promise);
    const store = useNotes();
    await store.fetchNotes();
    const loading = store.fetchMore();
    const created = note('new', { modifiedAt: 2 });
    apiMock.create.mockResolvedValue({ thing: created });
    await store.createNote(created.content);
    pending.resolve({ things: [note('stale')] });
    await loading;
    expect(store.things.value.some(t => t._id === 'stale')).toBe(false);
    expect(store.things.value[0]._id).toBe('new');
    expect(store.isLoadingMore.value).toBe(false);
  });

  it.each(['create', 'update'] as const)('restarts an in-flight filter reset after a local %s', async (mutation) => {
    const stale = deferred<{ things: Thing[] }>();
    const replacement = deferred<{ things: Thing[] }>();
    apiMock.list.mockResolvedValueOnce({ things: [note('old-a'), note('old-b')] })
      .mockReturnValueOnce(stale.promise).mockReturnValueOnce(replacement.promise);
    const store = useNotes();
    await store.fetchNotes();
    const filtering = store.setFilters({ search: '', tag: null, archived: true });
    if (mutation === 'create') {
      apiMock.create.mockResolvedValue({ thing: note('created') });
      await store.createNote('created');
    } else {
      apiMock.update.mockResolvedValue({ thing: note('old-a', { content: 'edited', revision: 2 }) });
      await store.updateNote('old-a', { content: 'edited' });
    }
    await flushPromises();
    expect(apiMock.list).toHaveBeenCalledTimes(3);
    expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ archived: true, skip: 0 }));
    expect(store.isLoading.value).toBe(true);

    stale.resolve({ things: [note('obsolete', { archived: true })] });
    await filtering;
    expect(store.things.value.some(t => t._id === 'obsolete')).toBe(false);
    expect(store.isLoading.value).toBe(true);
    replacement.resolve({ things: [note('new-filter', { archived: true })] });
    await flushPromises();
    expect(store.things.value.map(t => t._id)).toEqual(['new-filter']);
    expect(store.isLoading.value).toBe(false);
  });

  it('coalesces reset replacements for mutations completing together', async () => {
    const stale = deferred<{ things: Thing[] }>();
    const replacement = deferred<{ things: Thing[] }>();
    apiMock.list.mockReturnValueOnce(stale.promise).mockReturnValueOnce(replacement.promise);
    apiMock.create.mockResolvedValueOnce({ thing: note('one') }).mockResolvedValueOnce({ thing: note('two') });
    const store = useNotes();
    const loading = store.fetchNotes();
    await Promise.all([store.createNote('one'), store.createNote('two')]);
    await flushPromises();
    expect(apiMock.list).toHaveBeenCalledTimes(2);
    stale.resolve({ things: [note('obsolete')] });
    await loading;
    expect(store.isLoading.value).toBe(true);
    replacement.resolve({ things: [note('two'), note('one')] });
    await flushPromises();
    expect(store.things.value.map(t => t._id)).toEqual(['two', 'one']);
    expect(store.isLoading.value).toBe(false);
  });

  it('cancels a queued reset replacement when the user state resets', async () => {
    const stale = deferred<{ things: Thing[] }>();
    apiMock.list.mockReturnValueOnce(stale.promise);
    apiMock.create.mockResolvedValue({ thing: note('created') });
    const store = useNotes();
    const loading = store.fetchNotes();
    const mutation = store.createNote('created');
    await Promise.resolve();
    store.reset();
    await mutation;
    await flushPromises();
    expect(apiMock.list).toHaveBeenCalledTimes(1);
    stale.resolve({ things: [note('obsolete')] });
    await loading;
    expect(store.things.value).toEqual([]);
    expect(store.isLoading.value).toBe(false);
  });

  it('lets a newer filter request supersede a queued reset replacement', async () => {
    const stale = deferred<{ things: Thing[] }>();
    apiMock.list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ things: [note('latest')] });
    apiMock.create.mockResolvedValue({ thing: note('created') });
    const store = useNotes();
    const loading = store.fetchNotes();
    const mutation = store.createNote('created');
    await Promise.resolve();
    await store.setFilters({ search: 'latest', tag: null, archived: false });
    await mutation;
    stale.resolve({ things: [note('obsolete')] });
    await loading;
    await flushPromises();
    expect(apiMock.list).toHaveBeenCalledTimes(2);
    expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'latest', skip: 0 }));
    expect(store.things.value.map(t => t._id)).toEqual(['latest']);
    expect(store.isLoading.value).toBe(false);
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

  it('duplicates only content, color and independent attachment descriptors, preserving Markdown whitespace', async () => {
    const original = note('source', { content: '    code block\n', color: 'mint', public: true, shared: true, sticky: true, archived: true,
      attachments: [{ identifier: 'file-1', fileName: 'report.pdf', size: 12 }] });
    const created = note('copy', { content: original.content, color: 'mint', attachments: original.attachments });
    apiMock.create.mockResolvedValue({ thing: created });
    const store = useNotes();
    expect(await store.duplicateNote(original)).toEqual({ success: true, thing: created });
    const payload = apiMock.create.mock.calls[0][0];
    expect(payload).toEqual({ content: original.content, color: 'mint', attachments: original.attachments });
    expect(payload.attachments).not.toBe(original.attachments);
    expect(payload.attachments[0]).not.toBe(original.attachments[0]);
    expect(original).toMatchObject({ _id: 'source', revision: 1, public: true, shared: true, archived: true, sticky: true });
    expect(apiMock.update).not.toHaveBeenCalled();
    expect(store.things.value).toEqual([created]);
  });

  it('duplicates notes when attachments property is undefined', async () => {
    const original = note('source-no-attachments', { content: 'plain note', attachments: undefined });
    const created = note('copy-no-attachments', { content: 'plain note' });
    apiMock.create.mockResolvedValue({ thing: created });
    const store = useNotes();
    expect(await store.duplicateNote(original)).toEqual({ success: true, thing: created });
    expect(apiMock.create).toHaveBeenCalledWith({ content: 'plain note', attachments: [] });
  });

  it('keeps the source untouched and reports a failed duplicate', async () => {
    apiMock.create.mockRejectedValue(new Error('Copy failed'));
    const original = note('source');
    expect(await useNotes().duplicateNote(original)).toEqual({ success: false, error: 'Copy failed' });
    expect(original.content).toBe('note source');
    expect(apiMock.update).not.toHaveBeenCalled();
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

  it.each([
    { search: 'unmatched', tag: null, archived: false },
    { search: '', tag: 'other-label', archived: false },
    { search: '', tag: null, archived: true },
    { search: '', tag: null, archived: false, deleted: true },
  ])('places a delayed create in the current view, not the view it started in: %j', async (filters) => {
    const pending = deferred<{ thing: Thing }>();
    apiMock.create.mockReturnValue(pending.promise);
    apiMock.list.mockResolvedValue({ things: [] });
    const store = useNotes();
    const saving = store.createNote('new note');
    await store.setFilters(filters);

    pending.resolve({ thing: note('new') });
    expect((await saving).success).toBe(true);
    expect(store.things.value).toEqual([]);
    if (filters.search) {
      expect(apiMock.list).toHaveBeenLastCalledWith(expect.objectContaining({ filter: 'unmatched' }));
      expect(apiMock.list).toHaveBeenCalledTimes(2);
    }
  });

  it('updates matching note in place during active search without refetching', async () => {
    const original = note('one', { content: 'important meeting notes' });
    apiMock.list.mockResolvedValueOnce({ things: [original] });
    apiMock.update.mockResolvedValueOnce({ thing: note('one', { content: 'important meeting notes updated', revision: 2 }) });
    const store = useNotes();
    await store.setFilters({ search: 'meeting', tag: null, archived: false });
    expect(apiMock.list).toHaveBeenCalledTimes(1);

    const result = await store.updateNote('one', { content: 'important meeting notes updated' });
    expect(result.success).toBe(true);
    // Should stay in list and update in-place without triggering another apiMock.list call
    expect(apiMock.list).toHaveBeenCalledTimes(1);
    expect(store.things.value[0].content).toBe('important meeting notes updated');
  });

  it('removes a note after its exact searched tag changes', async () => {
    const original = note('one', { content: '#work', tags: ['work'] });
    apiMock.list.mockResolvedValueOnce({ things: [original] }).mockResolvedValue({ things: [] });
    apiMock.update.mockResolvedValue({ thing: note('one', { content: '#workshop', tags: ['workshop'], revision: 2 }) });
    const store = useNotes();
    await store.setFilters({ search: '#work', tag: null, archived: false });
    await store.updateNote('one', { content: '#workshop' });
    expect(store.things.value).toEqual([]);
  });

  it('keeps the dialog snapshot revision after an edit leaves the current search results', async () => {
    const original = note('one');
    apiMock.list.mockResolvedValueOnce({ things: [original] }).mockResolvedValue({ things: [] });
    apiMock.update
      .mockResolvedValueOnce({ thing: note('one', { content: 'unmatched', revision: 2 }) })
      .mockResolvedValueOnce({ thing: note('one', { content: 'newer draft', revision: 3 }) });
    apiMock.delete.mockResolvedValue({});
    const store = useNotes();
    await store.setFilters({ search: 'one', tag: null, archived: false });
    const first = await store.updateNote('one', { content: 'unmatched' });
    expect(store.things.value).toEqual([]);

    const second = await store.updateNote('one', { content: 'newer draft' }, first.thing);
    expect(second.success).toBe(true);
    expect(apiMock.update).toHaveBeenLastCalledWith('one', expect.objectContaining({ expectedRevision: 2 }));
    expect(store.things.value).toEqual([]);
    const deleted = await store.deleteNote('one', second.thing);
    expect(apiMock.delete).toHaveBeenCalledWith('one', 3);
    expect(deleted).toEqual({ success: true, thing: second.thing });
  });

  it('does not use another note as an off-list mutation snapshot', async () => {
    const store = useNotes();
    expect((await store.updateNote('one', { content: 'edit' }, note('other'))).success).toBe(false);
    expect((await store.deleteNote('one', note('other'))).success).toBe(false);
    expect(apiMock.update).not.toHaveBeenCalled();
    expect(apiMock.delete).not.toHaveBeenCalled();
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

  it('serializes same-note writes from the latest returned revision', async () => {
    const original = note('one');
    const firstResponse = deferred<{ thing: Thing }>();
    apiMock.list.mockResolvedValue({ things: [original] });
    apiMock.update
      .mockReturnValueOnce(firstResponse.promise)
      .mockImplementationOnce((_id, payload) => Promise.resolve({
        thing: note('one', { content: payload.content, revision: 3 }),
      }));
    const store = useNotes();
    await store.fetchNotes();

    const first = store.updateNote('one', { content: 'first' });
    const second = store.updateNote('one', { content: 'second' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiMock.update).toHaveBeenCalledTimes(1);
    firstResponse.resolve({ thing: note('one', { content: 'first', revision: 2 }) });
    await Promise.all([first, second]);

    expect(apiMock.update).toHaveBeenNthCalledWith(1, 'one', expect.objectContaining({
      content: 'first', expectedRevision: 1,
    }));
    expect(apiMock.update).toHaveBeenNthCalledWith(2, 'one', expect.objectContaining({
      content: 'second', expectedRevision: 2,
    }));
  });

  it('keeps the content edit snapshot revision even after the list refreshes', async () => {
    const base = note('one');
    const latest = note('one', { content: 'remote edit', revision: 2 });
    const store = useNotes();
    store.things.value = [latest];
    apiMock.update.mockRejectedValue({ code: 'revision_conflict' });
    apiMock.get.mockResolvedValue({ thing: latest });

    const result = await store.updateNote('one', { content: 'local draft' }, base);

    expect(apiMock.update).toHaveBeenCalledTimes(1);
    expect(apiMock.update).toHaveBeenCalledWith('one', expect.objectContaining({
      content: 'local draft', expectedRevision: 1,
    }));
    expect(result).toMatchObject({ success: false, code: 'revision_conflict', retryable: false });
    expect(store.things.value[0]).toEqual(latest);
  });

  it('uses the latest list revision for metadata-only writes, not a stale snapshot', async () => {
    const store = useNotes();
    const latest = note('one', { content: 'remote edit', revision: 2 });
    store.things.value = [latest];
    apiMock.update.mockResolvedValue({ thing: { ...latest, sticky: true, revision: 3 } });
    await store.updateNote('one', { sticky: true }, note('one'));
    expect(apiMock.update).toHaveBeenCalledWith('one', expect.objectContaining({
      content: 'remote edit', sticky: true, expectedRevision: 2,
    }));
  });

  it('keeps a draft and reports an explicit conflict on stale writes', async () => {
    apiMock.list.mockResolvedValue({ things: [note('one')] });
    apiMock.update.mockRejectedValue({ code: 'revision_conflict', message: 'stale revision' });
    apiMock.get.mockResolvedValue({ thing: note('one', { content: 'assistant rewrite', revision: 2 }) });
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.updateNote('one', { content: 'draft kept' });

    expect(result).toEqual({
      success: false,
      code: 'revision_conflict',
      retryable: false,
      error: 'This note changed elsewhere. Your draft was kept; reload before retrying.',
    });
    expect(store.things.value[0].content).toBe('note one');
  });

  it('retries once with a field-level merge when a concurrent write touched other fields', async () => {
    apiMock.list.mockResolvedValue({ things: [note('one')] });
    apiMock.update
      .mockRejectedValueOnce({ code: 'revision_conflict', message: 'stale revision' })
      .mockResolvedValueOnce({ thing: note('one', { content: 'my edit', sticky: true, color: 'mint', revision: 3 }) });
    apiMock.get.mockResolvedValue({ thing: note('one', { sticky: true, color: 'mint', revision: 2 }) });
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.updateNote('one', { content: 'my edit' });

    expect(result.success).toBe(true);
    expect(apiMock.update).toHaveBeenLastCalledWith('one', expect.objectContaining({
      content: 'my edit', sticky: true, expectedRevision: 2,
    }));
  });

  it('does not auto-merge over an assistant write and shows its trace instead', async () => {
    apiMock.list.mockResolvedValue({ things: [note('one')] });
    apiMock.update.mockRejectedValue({ code: 'revision_conflict', message: 'stale revision' });
    const assistant = { action: 'update', client: 'Gemini', at: 2, previous: { content: 'note one' } };
    apiMock.get.mockResolvedValue({ thing: note('one', { content: 'assistant rewrite', revision: 2, assistant }) });
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.updateNote('one', { sticky: true });

    expect(result).toEqual({
      success: false,
      code: 'revision_conflict',
      retryable: false,
      error: 'Gemini just edited this note. Your draft was kept; review the change, then save again.',
    });
    expect(apiMock.update).toHaveBeenCalledTimes(1);
    expect(store.things.value[0].assistant).toEqual(assistant);
  });

  it("reorders the visible list after a color update changes modifiedAt", async () => {
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

  it('restores a note from the trash list', async () => {
    const deleted = note('deleted', { deletedAt: 2 });
    apiMock.list.mockResolvedValue({ things: [deleted] });
    apiMock.restore.mockResolvedValue({ thing: note('deleted', { revision: 2 }) });
    const store = useNotes();
    await store.setFilters({ search: '', tag: null, archived: false, deleted: true });

    const result = await store.restoreNote('deleted');

    expect(result.success).toBe(true);
    expect(apiMock.restore).toHaveBeenCalledWith('deleted', 1);
    expect(store.things.value).toEqual([]);
  });

  it('deletes a note from the visible list', async () => {
    apiMock.list.mockResolvedValue({ things: [note('keep'), note('delete')] });
    apiMock.delete.mockResolvedValue(undefined);
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.deleteNote('delete');

    expect(result).toMatchObject({ success: true, thing: { _id: 'delete', revision: 1 } });
    expect(apiMock.delete).toHaveBeenCalledWith('delete', 1);
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
    expect(result.successfulIds).toEqual(['n1', 'n2']);
    expect(result.failedIds).toEqual([]);
    expect(apiMock.update).toHaveBeenCalledTimes(2);
    expect(store.things.value.every((t) => t.color === 'coral')).toBe(true);
  });

  it('handles partial failure in batch update', async () => {
    const n1 = note('n1', { color: 'default' });
    const n2 = note('n2', { color: 'default' });
    apiMock.list.mockResolvedValue({ things: [n1, n2] });
    apiMock.update.mockImplementation((id, payload) => {
      if (id === 'n2') return Promise.reject(new Error('Update failed'));
      return Promise.resolve({ thing: note(id, payload) });
    });
    const store = useNotes();
    await store.fetchNotes();

    const result = await store.batchUpdateNotes(['n1', 'n2'], { color: 'coral' });
    expect(result.success).toBe(false);
    expect(result.updatedCount).toBe(1);
    expect(result.successfulIds).toEqual(['n1']);
    expect(result.failedIds).toEqual(['n2']);
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
    expect(result.successfulIds).toEqual(['n1', 'n2']);
    expect(result.failedIds).toEqual([]);
    expect(apiMock.delete).toHaveBeenCalledTimes(2);
    expect(store.things.value.map((t) => t._id)).toEqual(['n3']);
  });

  it('undoes a delete by restoring the bumped revision and reinserting the pin', async () => {
    apiMock.list.mockResolvedValue({ things: [note('a', { sticky: true, revision: 3 })] });
    apiMock.delete.mockResolvedValue({});
    apiMock.restore.mockResolvedValue({ thing: note('a', { revision: 5 }) });
    apiMock.update.mockResolvedValue({ thing: note('a', { revision: 6, sticky: true }) });
    const store = useNotes();
    await store.setFilters({ search: '', tag: null, archived: false });

    const deleted = await store.deleteNote('a');
    expect(store.things.value).toHaveLength(0);

    const result = await store.undoDelete(deleted.thing!);
    expect(result.success).toBe(true);
    expect(apiMock.restore).toHaveBeenCalledWith('a', 4);
    expect(apiMock.update).toHaveBeenCalledWith('a', expect.objectContaining({ sticky: true, expectedRevision: 5 }));
    expect(store.things.value.map((t) => [t._id, t.sticky])).toEqual([['a', true]]);
  });

  it('undoes a delete using the revision current when the queued delete actually ran', async () => {
    apiMock.list.mockResolvedValue({ things: [note('a', { revision: 1 })] });
    apiMock.update.mockResolvedValue({ thing: note('a', { revision: 2, color: 'coral' }) });
    apiMock.delete.mockResolvedValue({});
    apiMock.restore.mockResolvedValue({ thing: note('a', { revision: 4 }) });
    const store = useNotes();
    await store.setFilters({ search: '', tag: null, archived: false });

    const colorChange = store.updateNote('a', { color: 'coral' });
    const deletion = store.deleteNote('a');
    await colorChange;
    const deleted = await deletion;

    expect(apiMock.delete).toHaveBeenCalledWith('a', 2);
    await store.undoDelete(deleted.thing!);
    expect(apiMock.restore).toHaveBeenCalledWith('a', 3);
  });

  it('undoes an archive from the active view even though the note left the list', async () => {
    apiMock.list.mockResolvedValue({ things: [note('a', { revision: 1 })] });
    apiMock.update
      .mockResolvedValueOnce({ thing: note('a', { revision: 2, archived: true }) })
      .mockResolvedValueOnce({ thing: note('a', { revision: 3, archived: false }) });
    const store = useNotes();
    await store.setFilters({ search: '', tag: null, archived: false });

    const archived = await store.toggleArchive(store.things.value[0]);
    expect(store.things.value).toHaveLength(0);

    const result = await store.undoArchive(archived.thing!);
    expect(result.success).toBe(true);
    expect(apiMock.update).toHaveBeenLastCalledWith('a', expect.objectContaining({ archived: false, expectedRevision: 2 }));
    expect(store.things.value.map((t) => t._id)).toEqual(['a']);
  });

  it('does not show a restored note in a label view it does not belong to', async () => {
    apiMock.list.mockResolvedValue({ things: [] });
    apiMock.restore.mockResolvedValue({ thing: note('a', { revision: 3, tags: ['work'] }) });
    const store = useNotes();
    await store.setFilters({ search: '', tag: 'home', archived: false });

    const result = await store.undoDelete(note('a', { revision: 2, tags: ['work'] }));
    expect(result.success).toBe(true);
    expect(store.things.value).toEqual([]);
  });
});
