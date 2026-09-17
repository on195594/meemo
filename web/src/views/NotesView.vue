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
                :selectable="isSelectionMode"
                :selected="selectedIds.has(thing._id)"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-delete-confirm="handleDeleteNote"
                @open-detail="openNoteModal"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @toggle-select="handleToggleSelect"
                @image-click="handleImageClick"
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
                :selectable="isSelectionMode"
                :selected="selectedIds.has(thing._id)"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-delete-confirm="handleDeleteNote"
                @open-detail="openNoteModal"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @toggle-select="handleToggleSelect"
                @image-click="handleImageClick"
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

      <!-- Floating Batch Action Bar -->
      <Transition name="batch-bar-slide">
        <aside v-if="isSelectionMode" class="batch-action-bar" role="toolbar" aria-label="Batch actions">
          <div class="batch-bar-leading">
            <button
              type="button"
              class="batch-btn batch-close-btn"
              title="Clear selection (Esc)"
              aria-label="Clear selection"
              :disabled="isBatchMutating"
              @click="handleClearSelection"
            >
              ✕
            </button>
            <span class="batch-count">{{ selectedIds.size }} selected</span>
            <button
              type="button"
              class="batch-text-btn"
              :disabled="isBatchMutating"
              @click="selectedIds.size === things.length ? handleClearSelection() : handleSelectAll()"
            >
              {{ selectedIds.size === things.length ? 'Deselect all' : 'Select all' }}
            </button>
          </div>

          <div class="batch-bar-actions">
            <!-- Color Picker Popover -->
            <div class="batch-color-wrapper">
              <button
                type="button"
                class="batch-btn"
                :class="{ active: showBatchColorPicker }"
                title="Change color for selected notes"
                aria-label="Change color for selected notes"
                aria-haspopup="true"
                :aria-expanded="showBatchColorPicker"
                :disabled="isBatchMutating"
                @click="showBatchColorPicker = !showBatchColorPicker"
              >
                🎨
              </button>
              <div
                v-if="showBatchColorPicker"
                class="batch-color-palette"
                role="group"
                aria-label="Select color for all"
              >
                <button
                  v-for="c in NOTE_COLORS"
                  :key="c.key"
                  type="button"
                  class="batch-swatch"
                  :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
                  :title="c.name"
                  :aria-label="c.name"
                  :disabled="isBatchMutating"
                  @click="handleBatchColor(c.key)"
                ></button>
              </div>
            </div>

            <!-- Pin / Unpin Toggle -->
            <button
              type="button"
              class="batch-btn"
              title="Toggle pin for selected notes"
              aria-label="Toggle pin for selected notes"
              :disabled="isBatchMutating"
              @click="handleBatchPin"
            >
              📌
            </button>

            <!-- Archive / Restore Toggle -->
            <button
              type="button"
              class="batch-btn"
              :title="isArchived ? 'Restore selected notes' : 'Archive selected notes'"
              :aria-label="isArchived ? 'Restore selected notes' : 'Archive selected notes'"
              :disabled="isBatchMutating"
              @click="handleBatchArchive"
            >
              {{ isArchived ? '↩️' : '📦' }}
            </button>

            <!-- Delete Button -->
            <button
              type="button"
              class="batch-btn batch-delete-btn"
              title="Delete selected notes"
              aria-label="Delete selected notes"
              :disabled="isBatchMutating"
              @click="showBatchDeleteConfirm = true"
            >
              🗑️
            </button>
          </div>
        </aside>
      </Transition>

      <!-- Batch Delete Confirmation Modal -->
      <div
        v-if="showBatchDeleteConfirm"
        class="batch-delete-modal-overlay"
        @click.self="showBatchDeleteConfirm = false"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm batch delete"
      >
        <div class="batch-delete-card">
          <h3>Delete {{ selectedIds.size }} Notes?</h3>
          <p>Are you sure you want to permanently delete these {{ selectedIds.size }} notes? This action cannot be undone.</p>
          <div class="batch-delete-actions">
            <button
              type="button"
              class="btn-modal cancel"
              :disabled="isBatchDeleting"
              @click="showBatchDeleteConfirm = false"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-modal confirm-delete"
              :disabled="isBatchDeleting"
              @click="handleBatchDelete"
            >
              <span v-if="isBatchDeleting">Deleting...</span>
              <span v-else>Delete All Permanently</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Fullscreen Image Lightbox -->
      <ImageLightbox
        :open="isLightboxOpen"
        :images="lightboxImages"
        :initial-index="lightboxIndex"
        @close="isLightboxOpen = false"
      />

      <!-- Google Keep Style Note Detail Modal -->
      <NoteDetailModal
        :open="isNoteModalOpen"
        :thing="activeModalNote"
        :can-edit="true"
        :initial-mode="modalInitialMode"
        :highlight-query="activeFilter || ''"
        :on-save-edit="updateNote"
        :on-delete-confirm="handleDeleteNote"
        @close="closeNoteModal"
        @toggle-sticky="handleToggleSticky"
        @toggle-public="handleTogglePublic"
        @toggle-archive="handleToggleArchive"
        @image-click="handleImageClick"
        @tag-click="handleTagClick"
        @wikilink-click="handleWikilinkClick"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, inject } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '../composables/useAuth';
import { useNotes } from '../composables/useNotes';
import { useSettings } from '../composables/useSettings';
import type { Thing, NoteColor } from '../api/client';
import { NOTE_COLORS } from '../constants/noteColors';
import NoteComposer from '../components/NoteComposer.vue';
import NoteCard from '../components/NoteCard.vue';
import NoteDetailModal from '../components/NoteDetailModal.vue';
import ImageLightbox, { type LightboxImage } from '../components/ImageLightbox.vue';

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
  batchUpdateNotes,
  batchDeleteNotes,
  toggleSticky,
  togglePublic,
  toggleArchive,
} = useNotes();

const categorizedThings = computed(() => {
  const pinned: Thing[] = [];
  const other: Thing[] = [];
  const list = things.value;
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (item.sticky) pinned.push(item);
    else other.push(item);
  }
  return { pinned, other };
});
const pinnedThings = computed(() => categorizedThings.value.pinned);
const otherThings = computed(() => categorizedThings.value.other);

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

const isNoteModalOpen = ref(false);
const activeModalNote = ref<Thing | null>(null);
const modalInitialMode = ref<'view' | 'edit'>('view');

function openNoteModal(thing: Thing, mode: 'view' | 'edit' = 'view') {
  if (isSelectionMode.value) {
    handleToggleSelect(thing);
    return;
  }
  activeModalNote.value = thing;
  modalInitialMode.value = mode;
  isNoteModalOpen.value = true;
}

function closeNoteModal() {
  isNoteModalOpen.value = false;
  activeModalNote.value = null;
}

watch(
  () => things.value,
  (newThings) => {
    if (activeModalNote.value && isNoteModalOpen.value) {
      const found = newThings.find((t) => t._id === activeModalNote.value?._id);
      if (found) {
        activeModalNote.value = found;
      }
    }
  },
  { deep: true }
);

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

// Fullscreen Image Lightbox
const isLightboxOpen = ref(false);
const lightboxImages = ref<LightboxImage[]>([]);
const lightboxIndex = ref(0);

function handleImageClick(images: LightboxImage[], index: number) {
  lightboxImages.value = images;
  lightboxIndex.value = index;
  isLightboxOpen.value = true;
}

// Batch Selection & Operations
const selectedIds = ref<Set<string>>(new Set());
const isSelectionMode = computed(() => selectedIds.value.size > 0);
const showBatchDeleteConfirm = ref(false);
const isBatchDeleting = ref(false);
const isBatchColorSaving = ref(false);
const isBatchUpdating = ref(false);
const isBatchMutating = computed(
  () => isBatchDeleting.value || isBatchColorSaving.value || isBatchUpdating.value
);
const showBatchColorPicker = ref(false);

function handleToggleSelect(thing: Thing) {
  if (isBatchMutating.value) return;
  const next = new Set(selectedIds.value);
  if (next.has(thing._id)) {
    next.delete(thing._id);
  } else {
    next.add(thing._id);
  }
  selectedIds.value = next;
}

function handleSelectAll() {
  if (isBatchMutating.value) return;
  selectedIds.value = new Set(things.value.map((t) => t._id));
}

function handleClearSelection() {
  if (isBatchMutating.value) return;
  selectedIds.value = new Set();
  showBatchColorPicker.value = false;
}

async function handleBatchColor(color: NoteColor) {
  if (isBatchMutating.value || selectedIds.value.size === 0) return;
  isBatchColorSaving.value = true;
  try {
    const ids = Array.from(selectedIds.value);
    const res = await batchUpdateNotes(ids, { color });
    showBatchColorPicker.value = false;
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    if (res.success) {
      showToast(`Updated color for ${res.updatedCount} note${res.updatedCount > 1 ? 's' : ''}`);
    } else {
      showToast(`Updated ${res.updatedCount} notes. ${res.failedIds.length} failed.`, 'info');
    }
  } finally {
    isBatchColorSaving.value = false;
  }
}

async function handleBatchPin() {
  if (isBatchMutating.value || selectedIds.value.size === 0) return;
  isBatchUpdating.value = true;
  try {
    const ids = Array.from(selectedIds.value);
    const selectedNotes = things.value.filter((t) => selectedIds.value.has(t._id));
    const shouldPin = selectedNotes.some((t) => !t.sticky);
    const res = await batchUpdateNotes(ids, { sticky: shouldPin });
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    if (res.success) {
      showToast(`${shouldPin ? 'Pinned' : 'Unpinned'} ${res.updatedCount} note${res.updatedCount > 1 ? 's' : ''}`);
    } else {
      showToast(`${shouldPin ? 'Pinned' : 'Unpinned'} ${res.updatedCount} notes. ${res.failedIds.length} failed.`, 'info');
    }
  } finally {
    isBatchUpdating.value = false;
  }
}

async function handleBatchArchive() {
  if (isBatchMutating.value || selectedIds.value.size === 0) return;
  isBatchUpdating.value = true;
  try {
    const ids = Array.from(selectedIds.value);
    const shouldArchive = !isArchived.value;
    const res = await batchUpdateNotes(ids, { archived: shouldArchive });
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    if (res.success) {
      showToast(`${shouldArchive ? 'Archived' : 'Restored'} ${res.updatedCount} note${res.updatedCount > 1 ? 's' : ''}`);
    } else {
      showToast(`${shouldArchive ? 'Archived' : 'Restored'} ${res.updatedCount} notes. ${res.failedIds.length} failed.`, 'info');
    }
  } finally {
    isBatchUpdating.value = false;
  }
}

async function handleBatchDelete() {
  if (isBatchMutating.value || selectedIds.value.size === 0) return;
  isBatchDeleting.value = true;
  try {
    const ids = Array.from(selectedIds.value);
    const res = await batchDeleteNotes(ids);
    showBatchDeleteConfirm.value = false;
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    if (res.success) {
      showToast(`Deleted ${res.deletedCount} note${res.deletedCount > 1 ? 's' : ''}`);
    } else {
      showToast(`Deleted ${res.deletedCount} notes. ${res.failedIds.length} failed.`, 'info');
    }
  } finally {
    isBatchDeleting.value = false;
  }
}

watch(things, (current) => {
  if (selectedIds.value.size === 0) return;
  const validIds = new Set(current.map((t) => t._id));
  const next = new Set([...selectedIds.value].filter((id) => validIds.has(id)));
  if (next.size !== selectedIds.value.size) {
    selectedIds.value = next;
  }
});

function handleGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    if (showBatchDeleteConfirm.value) {
      showBatchDeleteConfirm.value = false;
    } else if (showBatchColorPicker.value) {
      showBatchColorPicker.value = false;
    } else if (isSelectionMode.value && !isLightboxOpen.value) {
      handleClearSelection();
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
    handleClearSelection();
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
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  window.removeEventListener('meemo:imported', handleImportEvent);
  window.removeEventListener('keydown', handleGlobalKeydown);
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

/* Floating Batch Action Bar */
.batch-action-bar {
  position: fixed;
  bottom: 2rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.25rem;
  background-color: var(--md-sys-color-surface-container-highest, #e6e0e9);
  color: var(--md-sys-color-on-surface, #1d1b20);
  padding: 0.5rem 1rem;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  box-shadow: var(--md-sys-elevation-3, 0 4px 14px rgba(0, 0, 0, 0.25));
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.12));
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  max-width: 90vw;
}

.batch-bar-leading {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.batch-count {
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
}

.batch-text-btn {
  background: none;
  border: none;
  color: var(--md-sys-color-primary, #6750a4);
  font-size: 0.825rem;
  font-weight: 600;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  white-space: nowrap;
}

.batch-text-btn:hover {
  text-decoration: underline;
}

.batch-bar-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
}

.batch-btn {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface, #1d1b20);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1.1rem;
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.batch-btn:hover {
  background-color: rgba(0, 0, 0, 0.08);
}

.batch-btn.active {
  background-color: rgba(0, 0, 0, 0.12);
}

.batch-close-btn {
  font-size: 0.95rem;
  width: 32px;
  height: 32px;
}

.batch-delete-btn:hover {
  background-color: rgba(220, 53, 69, 0.15);
}

/* Batch Color Picker */
.batch-color-wrapper {
  position: relative;
}

.batch-color-palette {
  position: absolute;
  bottom: 50px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--md-sys-color-surface-container-highest, #e6e0e9);
  padding: 8px;
  border-radius: 16px;
  display: grid;
  grid-template-columns: repeat(4, 28px);
  gap: 8px;
  box-shadow: var(--md-sys-elevation-3, 0 4px 14px rgba(0, 0, 0, 0.25));
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.12));
  z-index: 600;
}

.batch-swatch {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.2));
  cursor: pointer;
  transition: transform 0.1s ease;
}

.batch-swatch:hover {
  transform: scale(1.15);
}

/* Transitions */
.batch-bar-slide-enter-active,
.batch-bar-slide-leave-active {
  transition: transform 0.25s cubic-bezier(0.1, 0.9, 0.2, 1), opacity 0.2s ease;
}

.batch-bar-slide-enter-from,
.batch-bar-slide-leave-to {
  transform: translate(-50%, 100%);
  opacity: 0;
}

/* Batch Delete Confirmation Modal */
.batch-delete-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
}

.batch-delete-card {
  background: var(--md-sys-color-surface-container-high, #ffffff);
  border-radius: var(--md-sys-shape-corner-2xl, 28px);
  padding: 1.75rem;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--md-sys-elevation-3);
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.1));
}

.batch-delete-card h3 {
  font-size: 1.25rem;
  color: var(--md-sys-color-error, #e53e3e);
  margin-bottom: 0.75rem;
}

.batch-delete-card p {
  font-size: 0.95rem;
  color: var(--md-sys-color-on-surface-variant, #4a5568);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.batch-delete-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

@media (max-width: 640px) {
  .batch-action-bar {
    bottom: 1rem;
    padding: 0.4rem 0.75rem;
    gap: 0.5rem;
    max-width: 95vw;
  }

  .batch-count {
    font-size: 0.8rem;
  }

  .batch-btn {
    width: 34px;
    height: 34px;
    font-size: 1rem;
  }
}
</style>
