import { ref, computed } from 'vue';
import { api, type Thing, type Tag, type AttachmentDescriptor, type NoteColor } from '../api/client';

// Module-level singleton state so App.vue header and NotesView share the same notes & search state
const things = ref<Thing[]>([]);
const tags = ref<Tag[]>([]);
const isLoading = ref(false);
const isLoadingMore = ref(false);
const hasMore = ref(true);
const error = ref<string | null>(null);

const searchQuery = ref('');
const selectedTag = ref<string | null>(null);
const isArchived = ref(false);
const isDeleted = ref(false);

const skip = ref(0);
const limit = ref(15);
let userGeneration = 0;
let notesRequestGeneration = 0;
let tagsRequestGeneration = 0;
const noteMutationQueues = new Map<string, Promise<unknown>>();

type NoteMutationResult = {
  success: boolean;
  thing?: Thing;
  error?: string;
  code?: string;
};

export function resetNotesState(): void {
  userGeneration++;
  notesRequestGeneration++;
  tagsRequestGeneration++;
  noteMutationQueues.clear();
  things.value = [];
  tags.value = [];
  isLoading.value = false;
  isLoadingMore.value = false;
  hasMore.value = true;
  error.value = null;
  searchQuery.value = '';
  selectedTag.value = null;
  isArchived.value = false;
  isDeleted.value = false;
  skip.value = 0;
}

const activeFilter = computed(() => {
  if (selectedTag.value) {
    return '#' + selectedTag.value;
  }
  return searchQuery.value.trim() || null;
});

const hasActiveFilter = computed(() => {
  return !!activeFilter.value || isArchived.value || isDeleted.value;
});

const MERGE_FIELDS = ['content', 'attachments', 'public', 'shared', 'archived', 'sticky', 'color'] as const;
type MergeField = typeof MERGE_FIELDS[number];

function fieldValue(thing: Record<string, any>, field: MergeField): unknown {
  if (field === 'content') return (thing.content || '').trim();
  if (field === 'attachments') return thing.attachments || [];
  if (field === 'color') return thing.color || 'default';
  return !!thing[field];
}

// Field-level three-way merge of a full PUT body; null when both sides changed the same field differently.
export function mergeUpdate(base: Thing, mine: Record<string, any>, theirs: Thing): Record<string, any> | null {
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const merged: Record<string, any> = { expectedRevision: theirs.revision };
  for (const field of MERGE_FIELDS) {
    if (!(field in mine)) continue;
    const b = fieldValue(base, field);
    const m = fieldValue(mine, field);
    const t = fieldValue(theirs, field);
    if (same(m, b)) merged[field] = t;
    else if (same(t, b) || same(t, m)) merged[field] = m;
    else return null;
  }
  return merged;
}

export function useNotes() {

  async function fetchTags(): Promise<void> {
    const generation = userGeneration;
    const requestGeneration = ++tagsRequestGeneration;
    try {
      const res = await api.things.tags();
      if (generation !== userGeneration || requestGeneration !== tagsRequestGeneration) return;
      tags.value = (res.tags || []).sort((a, b) => {
        if (b.usage !== a.usage) return b.usage - a.usage;
        return a.name.localeCompare(b.name);
      });
    } catch (err: any) {
      if (generation !== userGeneration || requestGeneration !== tagsRequestGeneration) return;
      console.warn('Failed to fetch tags:', err);
    }
  }

  async function fetchNotes(reset = true): Promise<void> {
    const generation = userGeneration;
    const requestGeneration = reset ? ++notesRequestGeneration : notesRequestGeneration;
    if (reset) {
      skip.value = 0;
      hasMore.value = true;
      isLoading.value = true;
      error.value = null;
    } else {
      if (isLoadingMore.value || !hasMore.value) return;
      isLoadingMore.value = true;
    }

    try {
      const filter = activeFilter.value || undefined;
      const listParams: Parameters<typeof api.things.list>[0] = {
        filter,
        archived: isArchived.value,
        skip: skip.value,
        limit: limit.value,
      };
      if (isDeleted.value) listParams.deleted = true;
      const res = await api.things.list(listParams);

      if (generation !== userGeneration || requestGeneration !== notesRequestGeneration) return;

      const fetchedThings = res.things || [];
      if (reset) {
        things.value = fetchedThings;
      } else {
        things.value = [...things.value, ...fetchedThings];
      }

      skip.value += fetchedThings.length;
      if (fetchedThings.length < limit.value) {
        hasMore.value = false;
      }
    } catch (err: any) {
      if (generation !== userGeneration || requestGeneration !== notesRequestGeneration) return;
      if (err.status !== 401) {
        error.value = err.message || 'Failed to load notes';
      }
    } finally {
      if (generation !== userGeneration || requestGeneration !== notesRequestGeneration) return;
      isLoading.value = false;
      isLoadingMore.value = false;
    }
  }

  async function fetchMore(): Promise<void> {
    if (isLoading.value || isLoadingMore.value || !hasMore.value) return;
    await fetchNotes(false);
  }

  async function setFilters(filters: { search: string; tag: string | null; archived: boolean; deleted?: boolean }): Promise<void> {
    searchQuery.value = filters.search;
    selectedTag.value = filters.tag;
    isArchived.value = filters.archived;
    isDeleted.value = filters.deleted === true;
    await fetchNotes(true);
  }

  // Write path operations (RF-504)
  function createNote(content: string, attachments: AttachmentDescriptor[] = [], color?: NoteColor) {
    return addNote(content?.trim(), attachments, color);
  }

  function duplicateNote(thing: Thing) {
    return addNote(thing.content, (thing.attachments || []).map(attachment => ({ ...attachment })), thing.color);
  }

  async function addNote(
    content: string,
    attachments: AttachmentDescriptor[] = [],
    color?: NoteColor
  ): Promise<{ success: boolean; thing?: Thing; error?: string }> {
    if (!content || !content.trim()) {
      return { success: false, error: 'Content cannot be empty' };
    }

    const generation = userGeneration;
    try {
      const payload: any = { content, attachments };
      if (color !== undefined) {
        payload.color = color;
      }
      const res = await api.things.create(payload);
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      placeNoteInCurrentView(res.thing);
      return { success: true, thing: res.thing };
    } catch (err: any) {
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      return { success: false, error: err.message || 'Failed to create note' };
    }
  }

  function enqueueNoteMutation<T>(id: string, generation: number, mutation: () => Promise<T>): Promise<T> {
    const previous = noteMutationQueues.get(id) || Promise.resolve();
    const next = previous.catch(() => undefined).then(() => {
      if (generation !== userGeneration) return Promise.reject(new Error('Session changed'));
      return mutation();
    });
    const tracked = next.finally(() => {
      if (noteMutationQueues.get(id) === tracked) noteMutationQueues.delete(id);
    });
    noteMutationQueues.set(id, tracked);
    return tracked;
  }

  async function updateNote(
    id: string,
    updates: Partial<Thing>,
    snapshot?: Thing
  ): Promise<NoteMutationResult> {
    const generation = userGeneration;
    return enqueueNoteMutation(id, generation, async () => {
      const existing = things.value.find((t) => t._id === id) || (snapshot?._id === id ? snapshot : undefined);
      if (!existing) {
        return { success: false, error: 'Note is no longer available', code: 'not_found' };
      }
      const content = updates.content !== undefined ? updates.content : existing.content;
      if (!content || !content.trim()) {
        return { success: false, error: 'Content cannot be empty' };
      }

      const payload: any = {
        content: content.trim(),
        attachments: updates.attachments !== undefined ? updates.attachments : (existing.attachments || []),
        public: updates.public !== undefined ? updates.public : (existing.public || false),
        shared: updates.shared !== undefined ? updates.shared : (existing.shared || false),
        archived: updates.archived !== undefined ? updates.archived : (existing.archived || false),
        sticky: updates.sticky !== undefined ? updates.sticky : (existing.sticky || false),
        expectedRevision: existing.revision,
      };
      if (updates.color !== undefined) payload.color = updates.color;

      try {
        let res;
        try {
          res = await api.things.update(id, payload);
        } catch (err: any) {
          if (err.code !== 'revision_conflict' || generation !== userGeneration) throw err;
          // Someone else (often the assistant) saved first; retry once if our fields don't overlap theirs.
          const latest = (await api.things.get(id)).thing;
          const merged = mergeUpdate(existing, payload, latest);
          if (!merged) throw err;
          res = await api.things.update(id, merged as typeof payload);
        }
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        const updated = res.thing;

        placeNoteInCurrentView(updated);
        return { success: true, thing: updated };
      } catch (err: any) {
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        const error = err.code === 'revision_conflict'
          ? 'This note changed elsewhere. Your draft was kept; reload before retrying.'
          : (err.message || 'Failed to update note');
        return { success: false, error, code: err.code };
      }
    }).catch((err: any) => ({
      success: false,
      error: err.message || 'Failed to update note',
      code: err.code,
    }));
  }

  async function restoreNote(id: string): Promise<NoteMutationResult> {
    const generation = userGeneration;
    return enqueueNoteMutation(id, generation, async () => {
      const existing = things.value.find((t) => t._id === id);
      if (!existing) return { success: false, error: 'Note is no longer available', code: 'not_found' };
      try {
        const res = await api.things.restore(id, existing.revision);
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        things.value = things.value.filter((t) => t._id !== id);
        return { success: true, thing: res.thing };
      } catch (err: any) {
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        const error = err.code === 'revision_conflict'
          ? 'This note changed elsewhere. Reload before restoring.'
          : (err.message || 'Failed to restore note');
        return { success: false, error, code: err.code };
      }
    }).catch((err: any) => ({
      success: false,
      error: err.message || 'Failed to restore note',
      code: err.code,
    }));
  }

  async function deleteNote(id: string, snapshot?: Thing): Promise<{ success: boolean; thing?: Thing; error?: string; code?: string }> {
    const generation = userGeneration;
    return enqueueNoteMutation(id, generation, async () => {
      const existing = things.value.find((t) => t._id === id) || (snapshot?._id === id ? snapshot : undefined);
      if (!existing) return { success: false, error: 'Note is no longer available', code: 'not_found' };
      try {
        await api.things.delete(id, existing.revision);
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        things.value = things.value.filter((t) => t._id !== id);
        // Return the exact snapshot that was deleted so Undo can use its revision.
        return { success: true, thing: existing };
      } catch (err: any) {
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        const error = err.code === 'revision_conflict'
          ? 'This note changed elsewhere. Reload before retrying deletion.'
          : (err.message || 'Failed to delete note');
        return { success: false, error, code: err.code };
      }
    }).catch((err: any) => ({
      success: false,
      error: err.message || 'Failed to delete note',
      code: err.code,
    }));
  }

  // Full PUT body rebuilt from a server snapshot, so Undo does not depend on list membership.
  function snapshotPayload(thing: Thing, overrides: { archived?: boolean; sticky?: boolean }) {
    return {
      content: thing.content,
      attachments: thing.attachments || [],
      public: !!thing.public,
      shared: !!thing.shared,
      archived: !!thing.archived,
      sticky: !!thing.sticky,
      expectedRevision: thing.revision,
      ...overrides,
    };
  }

  // Search matching belongs to the server; other views can place notes locally.
  function placeNoteInCurrentView(thing: Thing) {
    things.value = things.value.filter((t) => t._id !== thing._id);
    if (thing.archived !== isArchived.value || isDeleted.value) return;
    if (searchQuery.value.trim() && !selectedTag.value) {
      // Relevance search runs on the server; refetch instead of guessing a match.
      fetchNotes(true);
      return;
    }
    const tag = selectedTag.value?.toLowerCase();
    if (tag && !(thing.tags || []).some((t) => t.toLowerCase() === tag)) return;
    things.value = [...things.value, thing].sort((a, b) => {
      if (a.sticky !== b.sticky) return a.sticky ? -1 : 1;
      return (b.modifiedAt || 0) - (a.modifiedAt || 0);
    });
  }

  // `deleted` must be the snapshot deleteNote actually deleted (see its result.thing).
  async function undoDelete(deleted: Thing): Promise<NoteMutationResult> {
    const generation = userGeneration;
    return enqueueNoteMutation(deleted._id, generation, async () => {
      // Soft delete bumps the revision by exactly one (database/things.js del).
      const res = await api.things.restore(deleted._id, deleted.revision + 1);
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      let restored = res.thing;
      if (deleted.sticky && !restored.sticky) {
        const pinned = await api.things.update(restored._id, snapshotPayload(restored, { sticky: true }));
        if (generation !== userGeneration) return { success: false, error: 'Session changed' };
        restored = pinned.thing;
      }
      placeNoteInCurrentView(restored);
      return { success: true, thing: restored };
    }).catch((err: any) => ({ success: false, error: err.message || 'Failed to undo', code: err.code }));
  }

  // `changed` is the server copy returned by the archive toggle being undone.
  async function undoArchive(changed: Thing): Promise<NoteMutationResult> {
    const generation = userGeneration;
    return enqueueNoteMutation(changed._id, generation, async () => {
      const res = await api.things.update(changed._id, snapshotPayload(changed, { archived: !changed.archived }));
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      placeNoteInCurrentView(res.thing);
      return { success: true, thing: res.thing };
    }).catch((err: any) => ({ success: false, error: err.message || 'Failed to undo', code: err.code }));
  }

  async function toggleSticky(thing: Thing) {
    return updateNote(thing._id, { sticky: !thing.sticky }, thing);
  }

  async function togglePublic(thing: Thing) {
    return updateNote(thing._id, { public: !thing.public }, thing);
  }

  async function toggleArchive(thing: Thing) {
    return updateNote(thing._id, { archived: !thing.archived }, thing);
  }

  async function batchUpdateNotes(
    ids: string[],
    updates: Partial<Thing>
  ): Promise<{
    success: boolean;
    updatedCount: number;
    successfulIds: string[];
    updatedThings: Thing[];
    failedIds: string[];
    errors?: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};
    const successfulIds: string[] = [];
    const updatedThings: Thing[] = [];
    const failedIds: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const res = await updateNote(id, updates);
        if (res.success) {
          successfulIds.push(id);
          if (res.thing) updatedThings.push(res.thing);
        } else {
          failedIds.push(id);
          if (res.error) errors[id] = res.error;
        }
      })
    );
    return {
      success: failedIds.length === 0,
      updatedCount: successfulIds.length,
      successfulIds,
      updatedThings,
      failedIds,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    };
  }

  async function batchDeleteNotes(
    ids: string[]
  ): Promise<{
    success: boolean;
    deletedCount: number;
    successfulIds: string[];
    deletedThings: Thing[];
    failedIds: string[];
    errors?: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};
    const successfulIds: string[] = [];
    const deletedThings: Thing[] = [];
    const failedIds: string[] = [];
    await Promise.all(
      ids.map(async (id) => {
        const res = await deleteNote(id);
        if (res.success) {
          successfulIds.push(id);
          if (res.thing) deletedThings.push(res.thing);
        } else {
          failedIds.push(id);
          if (res.error) errors[id] = res.error;
        }
      })
    );
    return {
      success: failedIds.length === 0,
      deletedCount: successfulIds.length,
      successfulIds,
      deletedThings,
      failedIds,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    };
  }

  return {
    // State
    things,
    tags,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    searchQuery,
    selectedTag,
    isArchived,
    isDeleted,
    activeFilter,
    hasActiveFilter,

    // Read Actions
    fetchNotes,
    fetchMore,
    fetchTags,
    setFilters,
    reset: resetNotesState,

    // Write Actions
    createNote,
    duplicateNote,
    updateNote,
    deleteNote,
    restoreNote,
    batchUpdateNotes,
    batchDeleteNotes,
    toggleSticky,
    togglePublic,
    toggleArchive,
    undoArchive,
    undoDelete,
  };
}
