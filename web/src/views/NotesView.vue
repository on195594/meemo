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
      <!-- Active Filters Summary Banner -->
      <div v-if="hasActiveFilter" class="active-filter-bar">
        <span class="filter-label">Filter:</span>
        <span v-if="selectedTag" class="filter-chip">
          Tag: #{{ selectedTag }}
          <button type="button" class="chip-remove" @click="clearTagFilter">&times;</button>
        </span>
        <span v-if="searchQuery" class="filter-chip">
          Query: "{{ searchQuery }}"
          <button type="button" class="chip-remove" @click="handleQueryRemove">&times;</button>
        </span>
        <span v-if="isArchived" class="filter-chip archive-chip">
          Archived View
          <button type="button" class="chip-remove" @click="handleViewSwitch(false)">&times;</button>
        </span>
        <button type="button" class="clear-all-link" @click="clearRouteFilters">
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

      <!-- Main Cards Stream -->
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
          <!-- Pinned Section -->
          <section v-if="pinnedThings.length > 0" class="notes-section" aria-labelledby="pinned-heading">
            <h3 id="pinned-heading" class="section-label">PINNED</h3>
            <div class="m3-notes-masonry">
              <NoteCard
                v-for="thing in pinnedThings"
                :key="thing._id"
                :thing="thing"
                :can-edit="true"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-delete-confirm="handleDeleteNote"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @tag-click="handleTagClick"
                @wikilink-click="handleWikilinkClick"
              />
            </div>
          </section>

          <!-- Others Section -->
          <section v-if="otherThings.length > 0" class="notes-section" aria-labelledby="others-heading">
            <h3 v-if="pinnedThings.length > 0" id="others-heading" class="section-label">OTHERS</h3>
            <div class="m3-notes-masonry">
              <NoteCard
                v-for="thing in otherThings"
                :key="thing._id"
                :thing="thing"
                :can-edit="true"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-delete-confirm="handleDeleteNote"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @tag-click="handleTagClick"
                @wikilink-click="handleWikilinkClick"
              />
            </div>
          </section>

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
            @click="clearRouteFilters"
          >
            Clear filters
          </button>
        </div>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, inject } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';
import { useNotes } from '../composables/useNotes';
import { useSettings } from '../composables/useSettings';
import type { Thing } from '../api/client';
import NoteComposer from '../components/NoteComposer.vue';
import NoteCard from '../components/NoteCard.vue';

const { isAuthenticated, isLoading: authLoading, isFirstUser } = useAuth();
const { settings } = useSettings();
const route = useRoute();
const router = useRouter();
const openAuthModal = inject<((tab?: 'login' | 'register') => void) | undefined>('openAuthModal', undefined);

const {
  things,
  isLoading,
  isLoadingMore,
  hasMore,
  error,
  searchQuery,
  selectedTag,
  activeFilter,
  isArchived,
  hasActiveFilter,
  fetchNotes,
  fetchMore,
  setFilters,
  createNote,
  updateNote,
  deleteNote,
  toggleSticky,
  togglePublic,
  toggleArchive,
} = useNotes();

const pinnedThings = computed(() => things.value.filter((t) => t.sticky));
const otherThings = computed(() => things.value.filter((t) => !t.sticky));

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

function handleQueryRemove() {
  const query = { ...route.query };
  delete query.q;
  router.replace({ query });
}

function handleViewSwitch(archived: boolean) {
  router.replace({ query: { ...route.query, archived: archived ? 'true' : undefined } });
}

function handleTagClick(tag: string) {
  router.replace({ query: { ...route.query, q: undefined, tag } });
}

function handleWikilinkClick(target: string) {
  router.push({ query: { ...route.query, tag: undefined, q: target } });
}

function clearTagFilter() {
  const query = { ...route.query };
  delete query.tag;
  router.replace({ query });
}

function clearRouteFilters() {
  router.replace({ query: {} });
}

function syncRouteFilters() {
  const q = typeof route.query.q === 'string' ? route.query.q : '';
  const tag = typeof route.query.tag === 'string' ? route.query.tag : null;
  const archived = route.query.archived === '1' || route.query.archived === 'true';
  setFilters({ search: q, tag, archived });
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

watch(isAuthenticated, (authenticated) => {
  if (!authenticated) return;
  syncRouteFilters();
}, { immediate: true });

watch(
  () => [route.query.q, route.query.tag, route.query.archived],
  () => {
    if (isAuthenticated.value) syncRouteFilters();
  },
);

watch(hasMore, () => {
  if (loadMoreTrigger.value && observer && hasMore.value) {
    observer.observe(loadMoreTrigger.value);
  }
});

function handleImportEvent() {
  fetchNotes(true);
  showToast('Notes refreshed after import', 'info');
}

onMounted(() => {
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
  transition: max-width var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.notes-view.is-wide {
  max-width: 96%;
}

.loading-state {
  text-align: center;
  padding: 3rem 1rem;
  color: var(--md-sys-color-on-surface-variant);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid var(--md-sys-color-outline-variant);
  border-top-color: var(--md-sys-color-primary);
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
  background: var(--md-sys-color-surface-container);
  border-radius: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  box-shadow: var(--md-sys-elevation-2);
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
  color: var(--md-sys-color-on-surface);
  margin: 0;
}

.auth-hero p {
  color: var(--md-sys-color-on-surface-variant);
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
  transition: background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
  margin-top: 0.5rem;
}

.hero-btn.primary {
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}

.hero-btn.primary:hover {
  opacity: 0.9;
}


/* Active filter banner */
.active-filter-bar {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  background-color: var(--md-sys-color-surface-container-low);
  border: 1px solid var(--md-sys-color-outline-variant);
  padding: 0.5rem 0.85rem;
  border-radius: 10px;
  margin-bottom: 1.25rem;
  flex-wrap: wrap;
  font-size: 0.85rem;
  box-shadow: var(--md-sys-elevation-1);
}

.filter-label {
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
}

.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 14px;
  padding: 0.18rem 0.6rem;
  font-size: 0.8rem;
  color: var(--md-sys-color-on-surface);
  font-weight: 500;
}

.filter-chip.archive-chip {
  background-color: var(--md-sys-color-secondary-container);
  border-color: var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-secondary-container);
}

.chip-remove {
  background: none;
  border: none;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  font-size: 0.95rem;
  line-height: 1;
  padding: 0 0.15rem;
  border-radius: 50%;
  transition: color 0.15s;
}

.chip-remove:hover {
  color: var(--md-sys-color-error);
}

.clear-all-link {
  background: none;
  border: none;
  color: var(--md-sys-color-primary);
  cursor: pointer;
  font-size: 0.8rem;
  text-decoration: underline;
  margin-left: auto;
  font-weight: 500;
  transition: color 0.15s;
}

.clear-all-link:hover {
  opacity: 0.8;
}

.toast-banner {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.9rem;
  animation: fadeIn 0.2s ease-in-out;
}

.toast-banner.success {
  background-color: var(--md-sys-color-secondary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-secondary-container);
}

.toast-banner.info {
  background-color: var(--md-sys-color-primary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-primary-container);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.error-banner {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
  padding: 0.75rem;
  border-radius: 4px;
  margin-bottom: 1rem;
}

/* Layout */
.stream-column {
  min-width: 0;
  width: 100%;
}

.m3-notes-masonry {
  column-width: 280px;
  column-gap: 1rem;
}

.m3-notes-masonry > * {
  break-inside: avoid;
  page-break-inside: avoid;
  margin-bottom: 1rem;
  display: inline-block;
  width: 100%;
}

.notes-section {
  margin-bottom: 2rem;
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--md-sys-color-on-surface-variant, #718096);
  text-transform: uppercase;
  margin: 1.5rem 0 0.75rem 0.25rem;
}

.load-more-section {
  text-align: center;
  padding: 1.5rem 0;
}

.load-more-btn {
  background-color: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  padding: 0.6rem 1.5rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--md-sys-color-primary);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.load-more-btn:hover:not(:disabled) {
  background-color: var(--md-sys-color-primary-container);
  border-color: var(--md-sys-color-primary);
}

.load-more-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.end-marker {
  font-size: 0.85rem;
  color: var(--md-sys-color-on-surface-variant);
}

.empty-state {
  text-align: center;
  background: var(--md-sys-color-surface-container);
  border: 1px dashed var(--md-sys-color-outline-variant);
  border-radius: 12px;
  padding: 3.5rem 1.5rem;
  color: var(--md-sys-color-on-surface-variant);
}

.empty-icon {
  font-size: 2.75rem;
  margin-bottom: 0.75rem;
  opacity: 0.85;
}

.empty-state h3 {
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  margin-bottom: 0.5rem;
}

.clear-filters-btn {
  margin-top: 1.25rem;
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border: none;
  border-radius: 8px;
  padding: 0.5rem 1.25rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.clear-filters-btn:hover {
  box-shadow: var(--md-sys-elevation-1);
  opacity: 0.9;
}
</style>
