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

const skip = ref(0);
const limit = ref(15);
let userGeneration = 0;
let notesRequestGeneration = 0;
let tagsRequestGeneration = 0;

export function resetNotesState(): void {
  userGeneration++;
  notesRequestGeneration++;
  tagsRequestGeneration++;
  things.value = [];
  tags.value = [];
  isLoading.value = false;
  isLoadingMore.value = false;
  hasMore.value = true;
  error.value = null;
  searchQuery.value = '';
  selectedTag.value = null;
  isArchived.value = false;
  skip.value = 0;
}

const activeFilter = computed(() => {
  if (selectedTag.value) {
    return '#' + selectedTag.value;
  }
  return searchQuery.value.trim() || null;
});

const hasActiveFilter = computed(() => {
  return !!activeFilter.value || isArchived.value;
});

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
      const res = await api.things.list({
        filter,
        archived: isArchived.value,
        skip: skip.value,
        limit: limit.value,
      });

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

  async function setFilters(filters: { search: string; tag: string | null; archived: boolean }): Promise<void> {
    searchQuery.value = filters.search;
    selectedTag.value = filters.tag;
    isArchived.value = filters.archived;
    await fetchNotes(true);
  }

  function clearNotes(): void {
    resetNotesState();
  }

  // Write path operations (RF-504)
  async function createNote(
    content: string,
    attachments: AttachmentDescriptor[] = [],
    color?: NoteColor
  ): Promise<{ success: boolean; thing?: Thing; error?: string }> {
    if (!content || !content.trim()) {
      return { success: false, error: 'Content cannot be empty' };
    }

    const generation = userGeneration;
    try {
      const payload: any = { content: content.trim(), attachments };
      if (color !== undefined) {
        payload.color = color;
      }
      const res = await api.things.create(payload);
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      if (!isArchived.value) {
        if (res.thing.sticky) {
          things.value.unshift(res.thing);
        } else {
          const firstNonStickyIndex = things.value.findIndex((t) => !t.sticky);
          if (firstNonStickyIndex === -1) {
            things.value.push(res.thing);
          } else {
            things.value.splice(firstNonStickyIndex, 0, res.thing);
          }
        }
      }
      await fetchTags();
      return { success: true, thing: res.thing };
    } catch (err: any) {
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      return { success: false, error: err.message || 'Failed to create note' };
    }
  }

  async function updateNote(
    id: string,
    updates: Partial<Thing>
  ): Promise<{ success: boolean; thing?: Thing; error?: string }> {
    const existing = things.value.find((t) => t._id === id);
    const content = updates.content !== undefined ? updates.content : existing?.content;
    if (!content || !content.trim()) {
      return { success: false, error: 'Content cannot be empty' };
    }

    const payload: any = {
      content: content.trim(),
      attachments: updates.attachments !== undefined ? updates.attachments : (existing?.attachments || []),
      public: updates.public !== undefined ? updates.public : (existing?.public || false),
      shared: updates.shared !== undefined ? updates.shared : (existing?.shared || false),
      archived: updates.archived !== undefined ? updates.archived : (existing?.archived || false),
      sticky: updates.sticky !== undefined ? updates.sticky : (existing?.sticky || false),
    };
    if (updates.color !== undefined) {
      payload.color = updates.color;
    }

    const generation = userGeneration;
    try {
      const res = await api.things.update(id, payload);
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      const updated = res.thing;

      if (updated.archived !== isArchived.value) {
        // Remove from current view if archived state no longer matches view
        things.value = things.value.filter((t) => t._id !== id);
      } else {
        const index = things.value.findIndex((t) => t._id === id);
        if (index !== -1) {
          things.value.splice(index, 1, updated);
          if (updates.sticky !== undefined) {
            things.value.sort((a, b) => {
              if (a.sticky !== b.sticky) return a.sticky ? -1 : 1;
              return (b.modifiedAt || 0) - (a.modifiedAt || 0);
            });
          }
        }
      }
      await fetchTags();
      return { success: true, thing: updated };
    } catch (err: any) {
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      return { success: false, error: err.message || 'Failed to update note' };
    }
  }

  async function deleteNote(id: string): Promise<{ success: boolean; error?: string }> {
    const generation = userGeneration;
    try {
      await api.things.delete(id);
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      things.value = things.value.filter((t) => t._id !== id);
      await fetchTags();
      return { success: true };
    } catch (err: any) {
      if (generation !== userGeneration) return { success: false, error: 'Session changed' };
      return { success: false, error: err.message || 'Failed to delete note' };
    }
  }

  async function toggleSticky(thing: Thing) {
    return updateNote(thing._id, { sticky: !thing.sticky });
  }

  async function togglePublic(thing: Thing) {
    return updateNote(thing._id, { public: !thing.public });
  }

  async function toggleArchive(thing: Thing) {
    return updateNote(thing._id, { archived: !thing.archived });
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
    activeFilter,
    hasActiveFilter,

    // Read Actions
    fetchNotes,
    fetchMore,
    fetchTags,
    setFilters,
    clearNotes,
    reset: resetNotesState,

    // Write Actions
    createNote,
    updateNote,
    deleteNote,
    toggleSticky,
    togglePublic,
    toggleArchive,
  };
}
