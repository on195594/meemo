import { ref, computed } from 'vue';
import { api, type Thing, type Tag } from '../api/client';

export function useNotes() {
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

  const activeFilter = computed(() => {
    if (selectedTag.value) {
      return '#' + selectedTag.value;
    }
    return searchQuery.value.trim() || null;
  });

  const hasActiveFilter = computed(() => {
    return !!activeFilter.value || isArchived.value;
  });

  async function fetchTags(): Promise<void> {
    try {
      const res = await api.things.tags();
      tags.value = (res.tags || []).sort((a, b) => {
        if (b.usage !== a.usage) return b.usage - a.usage;
        return a.name.localeCompare(b.name);
      });
    } catch (err: any) {
      console.warn('Failed to fetch tags:', err);
    }
  }

  async function fetchNotes(reset = true): Promise<void> {
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
      if (err.status !== 401) {
        error.value = err.message || 'Failed to load notes';
      }
    } finally {
      isLoading.value = false;
      isLoadingMore.value = false;
    }
  }

  async function fetchMore(): Promise<void> {
    if (isLoading.value || isLoadingMore.value || !hasMore.value) return;
    await fetchNotes(false);
  }

  async function setSearch(query: string): Promise<void> {
    searchQuery.value = query;
    selectedTag.value = null;
    await fetchNotes(true);
  }

  async function selectTag(tagName: string | null): Promise<void> {
    if (selectedTag.value === tagName) {
      selectedTag.value = null;
    } else {
      selectedTag.value = tagName;
      searchQuery.value = '';
    }
    await fetchNotes(true);
  }

  async function toggleArchived(): Promise<void> {
    isArchived.value = !isArchived.value;
    await fetchNotes(true);
  }

  async function clearFilters(): Promise<void> {
    searchQuery.value = '';
    selectedTag.value = null;
    isArchived.value = false;
    await fetchNotes(true);
  }

  function clearNotes(): void {
    things.value = [];
    tags.value = [];
    skip.value = 0;
    hasMore.value = true;
    searchQuery.value = '';
    selectedTag.value = null;
    isArchived.value = false;
    error.value = null;
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

    // Actions
    fetchNotes,
    fetchMore,
    fetchTags,
    setSearch,
    selectTag,
    toggleArchived,
    clearFilters,
    clearNotes,
  };
}
