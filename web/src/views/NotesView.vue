<template>
  <div class="notes-view" :class="{ 'is-wide': settings.wide }">
    <!-- Unauthenticated View States -->
    <template v-if="!isAuthenticated">
      <div v-if="authLoading" class="loading-state">
        <span class="spinner"></span>
        <p>Loading Meemo...</p>
      </div>

      <!-- First-User Setup Prompt -->
      <div v-else-if="isFirstUser" class="auth-hero first-user-hero">
        <div class="hero-icon">🚀</div>
        <h2>Welcome to Meemo</h2>
        <p>No user account exists yet. Create your administrator account to start writing and organizing your thoughts.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('register')">
          Create Administrator Account
        </button>
      </div>

      <!-- General Sign In Prompt -->
      <div v-else class="auth-hero login-hero">
        <div class="hero-icon">🔒</div>
        <h2>Sign In to Meemo</h2>
        <p>Log in with your credentials to access your notes, attachments, and settings.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('login')">
          Log In
        </button>
      </div>
    </template>

    <!-- Authenticated Notes Workspace -->
    <template v-else>
      <!-- Search and View Control Toolbar -->
      <section class="notes-toolbar" aria-label="Notes search and filter toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input
            type="search"
            v-model="searchInput"
            class="search-input"
            placeholder="Search notes or #tags..."
            @keydown.enter="handleSearchSubmit"
          />
          <button
            v-if="searchInput"
            type="button"
            class="search-clear-btn"
            @click="handleSearchClear"
            title="Clear search"
          >
            &times;
          </button>
          <button
            type="button"
            class="search-submit-btn"
            @click="handleSearchSubmit"
          >
            Search
          </button>
        </div>

        <div class="view-toggles">
          <button
            v-if="!isArchived"
            type="button"
            class="view-toggle-btn"
            @click="handleViewSwitch(true)"
            title="View archived notes"
          >
            📦 Archive
          </button>
          <button
            v-else
            type="button"
            class="view-toggle-btn active"
            @click="handleViewSwitch(false)"
            title="Back to active notes"
          >
            ↩️ Back to Notes
          </button>
        </div>
      </section>

      <!-- Active Filters Summary Banner -->
      <div v-if="hasActiveFilter" class="active-filter-bar">
        <span class="filter-label">Filter:</span>
        <span v-if="selectedTag" class="filter-chip">
          Tag: #{{ selectedTag }}
          <button type="button" class="chip-remove" @click="selectTag(null)">&times;</button>
        </span>
        <span v-if="searchQuery" class="filter-chip">
          Query: "{{ searchQuery }}"
          <button type="button" class="chip-remove" @click="handleQueryRemove">&times;</button>
        </span>
        <span v-if="isArchived" class="filter-chip archive-chip">
          Archived View
          <button type="button" class="chip-remove" @click="handleViewSwitch(false)">&times;</button>
        </span>
        <button type="button" class="clear-all-link" @click="clearFilters">
          Reset all filters
        </button>
      </div>

      <!-- Notification Toast -->
      <div v-if="toastMessage" class="toast-banner" :class="toastType" role="status">
        {{ toastMessage }}
      </div>

      <!-- Error Notice -->
      <div v-if="error" class="error-banner" role="alert">
        {{ error }}
      </div>

      <!-- Main Layout: Cards Stream & Tags Sidebar -->
      <div class="notes-layout" :class="{ 'no-sidebar': settings.showTagSidebar === false }">
        <!-- Center Stream Column -->
        <main class="stream-column">
          <!-- Note Composer (visible in active notes view) -->
          <NoteComposer
            v-if="!isArchived"
            :on-save="createNote"
            @created="onNoteCreated"
          />

          <div v-if="isLoading" class="loading-state">
            <span class="spinner"></span>
            <p>Loading notes...</p>
          </div>

          <!-- Notes Card List -->
          <div v-else-if="things.length > 0" class="notes-card-list">
            <NoteCard
              v-for="thing in things"
              :key="thing._id"
              :thing="thing"
              :can-edit="true"
              :on-save-edit="updateNote"
              :on-delete-confirm="handleDeleteNote"
              @toggle-sticky="handleToggleSticky"
              @toggle-public="handleTogglePublic"
              @toggle-archive="handleToggleArchive"
              @tag-click="handleTagClick"
            />

            <!-- Infinite Scroll / Load More Footer -->
            <div ref="loadMoreTrigger" class="load-more-section">
              <button
                v-if="hasMore"
                type="button"
                class="load-more-btn"
                :disabled="isLoadingMore"
                @click="fetchMore"
              >
                <span v-if="isLoadingMore">Loading more notes...</span>
                <span v-else>Load more notes</span>
              </button>
              <p v-else class="end-marker">
                — You have reached the end of the notes —
              </p>
            </div>
          </div>

          <!-- Empty Results State -->
          <div v-else class="empty-state">
            <div class="empty-icon">{{ isArchived ? '📦' : '📝' }}</div>
            <h3 v-if="hasActiveFilter">No notes found matching your filter</h3>
            <h3 v-else-if="isArchived">No archived notes</h3>
            <h3 v-else>No notes found</h3>
            <p v-if="hasActiveFilter">Try adjusting your search terms or clearing tag filters.</p>
            <p v-else-if="isArchived">Notes you archive will appear here.</p>
            <p v-else>Type a note in the composer above to begin!</p>
            <button
              v-if="hasActiveFilter"
              type="button"
              class="clear-filters-btn"
              @click="clearFilters"
            >
              Clear filters
            </button>
          </div>
        </main>

        <!-- Right Tag Cloud Sidebar -->
        <aside v-if="settings.showTagSidebar !== false" class="sidebar-column">
          <TagSidebar
            :tags="tags"
            :selected-tag="selectedTag"
            @select-tag="handleTagClick"
            @clear-tag="selectTag(null)"
          />
        </aside>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, inject } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useNotes } from '../composables/useNotes';
import { useSettings } from '../composables/useSettings';
import type { Thing } from '../api/client';
import NoteComposer from '../components/NoteComposer.vue';
import NoteCard from '../components/NoteCard.vue';
import TagSidebar from '../components/TagSidebar.vue';

const { isAuthenticated, isLoading: authLoading, isFirstUser, sessionExpired } = useAuth();
const { settings } = useSettings();
const openAuthModal = inject<((tab?: 'login' | 'register') => void) | undefined>('openAuthModal', undefined);

const {
  things,
  tags,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  searchQuery,
  selectedTag,
  isArchived,
  hasActiveFilter,
  fetchNotes,
  fetchMore,
  fetchTags,
  setSearch,
  selectTag,
  toggleArchived,
  clearFilters,
  clearNotes,
  createNote,
  updateNote,
  deleteNote,
  toggleSticky,
  togglePublic,
  toggleArchive,
} = useNotes();

const searchInput = ref('');
const loadMoreTrigger = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

const toastMessage = ref<string | null>(null);
const toastType = ref<'success' | 'info'>('info');
let toastTimer: number | null = null;

function showToast(msg: string, type: 'success' | 'info' = 'info') {
  toastMessage.value = msg;
  toastType.value = type;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMessage.value = null;
  }, 2500);
}

function triggerAuthModal(tab: 'login' | 'register') {
  if (openAuthModal) {
    openAuthModal(tab);
  }
}

function onNoteCreated() {
  showToast('Note created successfully', 'success');
}

async function handleToggleSticky(thing: Thing) {
  const result = await toggleSticky(thing);
  if (result.success) {
    showToast(thing.sticky ? 'Note unpinned' : 'Note pinned to top');
  }
}

async function handleTogglePublic(thing: Thing) {
  const result = await togglePublic(thing);
  if (result.success) {
    showToast(thing.public ? 'Note is now private' : 'Note is now public');
  }
}

async function handleToggleArchive(thing: Thing) {
  const result = await toggleArchive(thing);
  if (result.success) {
    showToast(thing.archived ? 'Note restored to active' : 'Note archived');
  }
}

async function handleDeleteNote(id: string) {
  const result = await deleteNote(id);
  if (result.success) {
    showToast('Note permanently deleted');
  }
  return result;
}

function handleSearchSubmit() {
  const q = searchInput.value.trim();
  if (q.startsWith('#')) {
    selectTag(q.slice(1));
    searchInput.value = '';
  } else {
    setSearch(q);
  }
}

function handleSearchClear() {
  searchInput.value = '';
  setSearch('');
}

function handleQueryRemove() {
  searchInput.value = '';
  setSearch('');
}

function handleViewSwitch(archived: boolean) {
  if (isArchived.value !== archived) {
    toggleArchived();
  }
}

function handleTagClick(tag: string) {
  selectTag(tag);
}

function setupIntersectionObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  if (typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting && hasMore.value && !isLoading.value && !isLoadingMore.value) {
        fetchMore();
      }
    }, { rootMargin: '200px' });

    if (loadMoreTrigger.value) {
      observer.observe(loadMoreTrigger.value);
    }
  }
}

let initialLoadTriggered = false;

watch(sessionExpired, (expired) => {
  if (expired) {
    initialLoadTriggered = false;
  }
});

watch(isAuthenticated, (authenticated) => {
  if (authenticated) {
    if (!initialLoadTriggered) {
      fetchNotes(true);
      fetchTags();
    }
    initialLoadTriggered = false;
  } else {
    initialLoadTriggered = false;
    clearNotes();
  }
});

watch(hasMore, () => {
  if (loadMoreTrigger.value && observer && hasMore.value) {
    observer.observe(loadMoreTrigger.value);
  }
});

function handleImportEvent() {
  fetchNotes(true);
  fetchTags();
  showToast('Notes refreshed after import', 'info');
}

onMounted(() => {
  const hasSession = typeof localStorage !== 'undefined' && localStorage.getItem('meemo_has_session') === '1';
  if (isAuthenticated.value || hasSession) {
    initialLoadTriggered = true;
    fetchNotes(true);
    fetchTags();
  }
  setupIntersectionObserver();
  window.addEventListener('meemo:imported', handleImportEvent);
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  window.removeEventListener('meemo:imported', handleImportEvent);
});
</script>

<style scoped>
.notes-view {
  max-width: 1040px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  transition: max-width 0.2s;
}

.notes-view.is-wide {
  max-width: 96%;
}

.notes-layout.no-sidebar {
  grid-template-columns: 1fr;
}

.loading-state {
  text-align: center;
  padding: 3rem 1rem;
  color: #718096;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #e2e8f0;
  border-top-color: #3182ce;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.auth-hero {
  text-align: center;
  margin-top: 3rem;
  padding: 2.5rem 1.5rem;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.hero-icon {
  font-size: 2.5rem;
}

.auth-hero h2 {
  font-size: 1.5rem;
  color: #1a202c;
  margin: 0;
}

.auth-hero p {
  color: #4a5568;
  max-width: 480px;
  font-size: 1rem;
}

.hero-btn {
  padding: 0.65rem 1.5rem;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 0.5rem;
}

.hero-btn.primary {
  background-color: #2b6cb0;
  color: #ffffff;
}

.hero-btn.primary:hover {
  background-color: #2c5282;
}

/* Toolbar */
.notes-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
  flex-wrap: wrap;
}

.search-box {
  display: flex;
  align-items: center;
  background: #ffffff;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  padding: 0.25rem 0.5rem;
  flex: 1;
  min-width: 240px;
  max-width: 480px;
}

.search-icon {
  font-size: 0.9rem;
  margin-right: 0.4rem;
  color: #a0aec0;
}

.search-input {
  border: none;
  outline: none;
  width: 100%;
  font-size: 0.9rem;
  color: #2d3748;
}

.search-clear-btn {
  background: none;
  border: none;
  color: #a0aec0;
  font-size: 1.1rem;
  cursor: pointer;
  padding: 0 0.3rem;
}

.search-submit-btn {
  background-color: #edf2f7;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 0.25rem 0.6rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  margin-left: 0.25rem;
}

.search-submit-btn:hover {
  background-color: #e2e8f0;
  color: #2b6cb0;
}

.view-toggles {
  display: flex;
  gap: 0.5rem;
}

.view-toggle-btn {
  background: #ffffff;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  padding: 0.4rem 0.8rem;
  font-size: 0.85rem;
  font-weight: 500;
  color: #4a5568;
  cursor: pointer;
  transition: all 0.2s;
}

.view-toggle-btn:hover {
  border-color: #3182ce;
  color: #2b6cb0;
}

.view-toggle-btn.active {
  background-color: #ebf8ff;
  border-color: #3182ce;
  color: #2b6cb0;
  font-weight: 600;
}

/* Active filter banner */
.active-filter-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background-color: #edf2f7;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
}

.filter-label {
  font-weight: 600;
  color: #4a5568;
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: #ffffff;
  border: 1px solid #cbd5e0;
  border-radius: 12px;
  padding: 0.15rem 0.5rem;
  font-size: 0.8rem;
  color: #2d3748;
}

.filter-chip.archive-chip {
  background-color: #fefcbf;
  border-color: #faf089;
  color: #744210;
}

.chip-remove {
  background: none;
  border: none;
  color: #718096;
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1;
}

.chip-remove:hover {
  color: #e53e3e;
}

.clear-all-link {
  background: none;
  border: none;
  color: #3182ce;
  cursor: pointer;
  font-size: 0.8rem;
  text-decoration: underline;
  margin-left: auto;
}

.toast-banner {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  animation: fadeIn 0.2s ease-in-out;
}

.toast-banner.success {
  background-color: #f0fff4;
  border: 1px solid #c6f6d5;
  color: #276749;
}

.toast-banner.info {
  background-color: #ebf8ff;
  border: 1px solid #bee3f8;
  color: #2b6cb0;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.error-banner {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}

/* Layout */
.notes-layout {
  display: grid;
  grid-template-columns: 1fr 240px;
  gap: 1.5rem;
  align-items: start;
}

@media (max-width: 768px) {
  .notes-layout {
    grid-template-columns: 1fr;
  }
}

.stream-column {
  min-width: 0;
}

.sidebar-column {
  position: sticky;
  top: 5rem;
}

.load-more-section {
  text-align: center;
  padding: 1.5rem 0;
}

.load-more-btn {
  background-color: #ffffff;
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  padding: 0.6rem 1.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #3182ce;
  cursor: pointer;
  transition: all 0.2s;
}

.load-more-btn:hover:not(:disabled) {
  background-color: #ebf8ff;
  border-color: #3182ce;
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.end-marker {
  font-size: 0.85rem;
  color: #a0aec0;
}

.empty-state {
  text-align: center;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 3rem 1.5rem;
  color: #718096;
}

.empty-icon {
  font-size: 2.5rem;
  margin-bottom: 0.5rem;
}

.empty-state h3 {
  font-size: 1.2rem;
  color: #2d3748;
  margin-bottom: 0.5rem;
}

.clear-filters-btn {
  margin-top: 1rem;
  background-color: #2b6cb0;
  color: #ffffff;
  border: none;
  border-radius: 6px;
  padding: 0.5rem 1rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.clear-filters-btn:hover {
  background-color: #2c5282;
}
</style>
