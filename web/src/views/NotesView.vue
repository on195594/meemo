<template>
  <div class="notes-view" :class="{ 'is-wide': settings.wide, 'is-selecting': isSelectionMode }">
    <!-- Unauthenticated View States -->
    <template v-if="!isAuthenticated">
      <div v-if="authLoading" class="loading-state">
        <span class="spinner"></span>
        <p>Loading Meemo...</p>
      </div>

      <!-- First-User Setup Prompt -->
      <div v-else-if="isFirstUser" class="auth-hero first-user-hero">
        <div class="hero-icon"><UiIcon name="note" /></div>
        <h1>Welcome to Meemo</h1>
        <p>No user account exists yet. Create your administrator account to start writing and organizing your thoughts.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('register')">
          Create Administrator Account
        </button>
      </div>

      <!-- General Sign In Prompt -->
      <div v-else class="auth-hero login-hero">
        <div class="hero-icon"><UiIcon name="lock" /></div>
        <h1>Sign In to Meemo</h1>
        <p>Log in with your credentials to access your notes, attachments, and settings.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('login')">
          Log In
        </button>
      </div>
    </template>

    <!-- Authenticated Notes Workspace -->
    <template v-else>
      <!-- Search Results Banner -->
      <div v-if="searchQuery" class="active-filter-bar">
        <span class="filter-label">Results for “{{ searchQuery }}”</span>
        <button type="button" class="clear-all-link" @click="handleQueryRemove">Clear search</button>
      </div>

      <!-- Error Notice -->
      <div v-if="error" class="error-banner" role="alert">
        {{ error }}
      </div>

      <!-- Main Cards Stream -->
      <main ref="streamRef" class="stream-column">
        <h1 class="workspace-title" :class="{ 'is-named-view': viewTitle !== 'Notes' }">{{ viewTitle }}</h1>
        <!-- Note Composer (visible in active notes view) -->
        <!-- v-show keeps an unsaved draft alive while browsing Archive/Trash -->
        <NoteComposer
          v-show="!isArchived && !isDeleted"
          :active="!isArchived && !isDeleted"
          :on-save="createNote"
          :draft-scope="user?.id"
        />

        <!-- Top Search/Filter Loading Bar when updating existing notes -->
        <div v-if="isLoading && things.length > 0" class="search-progress-bar" role="progressbar" aria-label="Updating notes">
          <div class="progress-indicator"></div>
        </div>

        <div v-if="isLoading && things.length === 0" class="loading-state">
          <span class="spinner"></span>
          <p>Loading notes...</p>
        </div>

        <!-- Notes Card List -->
        <div v-else-if="things.length > 0" class="notes-card-list" :class="{ 'is-refreshing': isLoading }" :style="{ '--grid-width': gridWidth }">
          <!-- Pinned Section -->
          <section v-if="pinnedThings.length > 0" class="notes-section" aria-labelledby="pinned-heading">
            <h2 id="pinned-heading" class="section-label">Pinned</h2>
            <div class="m3-notes-masonry" :class="{ 'is-list': viewMode === 'list', 'is-compact': isCompact }">
              <div v-for="(column, ci) in pinnedColumns" :key="'pinned-' + ci" class="masonry-column">
              <NoteCard
                v-for="thing in column"
                :key="thing._id"
                :thing="thing"
                :can-edit="!isDeleted"
                :selectable="isSelectionMode"
                :selected="selectedIds.has(thing._id)"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-duplicate="handleDuplicateNote"
                :duplicating="copyingIds.has(thing._id)"
                :on-restore="isDeleted ? handleRestoreNote : undefined"
                @open-detail="openNoteModal"
                @delete="handleDeleteNote"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @toggle-select="handleToggleSelect"
                @image-click="handleImageClick"
                @tag-click="handleTagClick"
                @wikilink-click="handleWikilinkClick"
              />
              </div>
            </div>
          </section>

          <!-- Others Section -->
          <section v-if="otherThings.length > 0" class="notes-section" :aria-labelledby="pinnedThings.length > 0 ? 'others-heading' : undefined">
            <h2 v-if="pinnedThings.length > 0" id="others-heading" class="section-label">Others</h2>
            <div class="m3-notes-masonry" :class="{ 'is-list': viewMode === 'list', 'is-compact': isCompact }">
              <div v-for="(column, ci) in otherColumns" :key="'other-' + ci" class="masonry-column">
              <NoteCard
                v-for="thing in column"
                :key="thing._id"
                :thing="thing"
                :can-edit="!isDeleted"
                :selectable="isSelectionMode"
                :selected="selectedIds.has(thing._id)"
                :highlight-query="activeFilter || ''"
                :on-save-edit="updateNote"
                :on-duplicate="handleDuplicateNote"
                :duplicating="copyingIds.has(thing._id)"
                :on-restore="isDeleted ? handleRestoreNote : undefined"
                @open-detail="openNoteModal"
                @delete="handleDeleteNote"
                @toggle-sticky="handleToggleSticky"
                @toggle-public="handleTogglePublic"
                @toggle-archive="handleToggleArchive"
                @toggle-select="handleToggleSelect"
                @image-click="handleImageClick"
                @tag-click="handleTagClick"
                @wikilink-click="handleWikilinkClick"
              />
              </div>
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
          </div>
        </div>

        <!-- Empty Results State -->
        <div v-else class="empty-state">
          <div class="empty-icon"><UiIcon :name="isDeleted ? 'trash' : (isArchived ? 'archive' : (selectedTag ? 'label' : (activeFilter ? 'search' : 'bulb')))" /></div>
          <h2 v-if="activeFilter && !selectedTag">No matching results</h2>
          <h2 v-else-if="isDeleted">No notes in Trash</h2>
          <h2 v-else-if="isArchived">Your archived notes appear here</h2>
          <h2 v-else-if="selectedTag">No notes with this label yet</h2>
          <h2 v-else>Notes you add appear here</h2>
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
              <UiIcon name="close" />
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
            <div ref="batchColorWrapperRef" class="batch-color-wrapper">
              <button
                ref="batchColorTriggerRef"
                type="button"
                class="batch-btn"
                :class="{ active: showBatchColorPicker }"
                title="Change color for selected notes"
                aria-label="Change color for selected notes"
                aria-haspopup="true"
                :aria-expanded="showBatchColorPicker"
                :disabled="isBatchMutating"
                @click="toggleBatchColorPicker"
              >
                <UiIcon name="palette" />
              </button>
              <div
                v-if="showBatchColorPicker"
                ref="batchColorPaletteRef"
                class="batch-color-palette"
                role="group"
                aria-label="Select color for all"
              >
                <button
                  v-for="(c, index) in NOTE_COLORS"
                  :key="c.key"
                  type="button"
                  class="batch-swatch"
                  :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
                  :title="c.name"
                  :aria-label="c.name"
                  :tabindex="focusedBatchColorIndex === index ? 0 : -1"
                  :disabled="isBatchMutating"
                  @click="handleBatchColor(c.key)"
                  @keydown="handleBatchColorKeydown($event, index)"
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
              <UiIcon name="pin" />
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
              <UiIcon :name="isArchived ? 'restore' : 'archive'" />
            </button>

            <!-- Delete Button -->
            <button
              type="button"
              class="batch-btn batch-delete-btn"
              title="Delete selected notes"
              aria-label="Delete selected notes"
              :disabled="isBatchMutating"
              @click="handleBatchDelete"
            >
              <UiIcon name="trash" />
            </button>
          </div>
        </aside>
      </Transition>

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
        :can-edit="!isDeleted"
        :busy="isModalMutating || copyingIds.has(activeModalNoteId || '')"
        :duplicating="copyingIds.has(activeModalNoteId || '')"
        :on-duplicate="handleDuplicateNote"
        :on-save-edit="saveModalNote"
        :draft-scope="user?.id"
        @close="closeNoteModal"
        @delete="handleModalDelete"
        @toggle-sticky="handleToggleSticky"
        @toggle-public="handleTogglePublic"
        @toggle-archive="handleModalArchive"
        @image-click="handleImageClick"
        @tag-click="handleTagClick"
        @wikilink-click="handleWikilinkClick"
      />

      <!-- Keep-style snackbar with optional Undo -->
      <Transition name="snackbar">
        <div v-if="snackbar" class="snackbar" role="status" aria-live="polite">
          <span class="snackbar-text">{{ snackbar.message }}</span>
          <button v-if="snackbar.undo" type="button" class="snackbar-action" @click="runUndo">Undo</button>
          <button type="button" class="snackbar-close" aria-label="Dismiss" @click="dismissSnackbar">
            <UiIcon name="close" />
          </button>
        </div>
      </Transition>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, inject, nextTick, type Ref } from 'vue';
import UiIcon from '../components/UiIcon.vue';
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
import { distributeColumns, columnCountFor } from '../utils/masonry';

const { isAuthenticated, isLoading: authLoading, isFirstUser, user } = useAuth();
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
  isDeleted,
  fetchNotes,
  fetchMore,
  setFilters,
  createNote,
  duplicateNote,
  updateNote,
  deleteNote,
  batchUpdateNotes,
  batchDeleteNotes,
  restoreNote,
  toggleSticky,
  togglePublic,
  toggleArchive,
  undoArchive,
  undoDelete,
} = useNotes();

const viewMode = inject<Ref<'grid' | 'list'>>('viewMode', ref('grid'));
const viewTitle = computed(() => {
  if (isDeleted.value) return 'Trash';
  if (isArchived.value) return 'Archive';
  if (selectedTag.value) return selectedTag.value;
  return 'Notes';
});

const gridWidth = computed(() => {
  if (viewMode.value === 'list') return '600px';
  if (isCompact.value) return '100%';
  return `${columnCount.value * 240 + (columnCount.value - 1) * 16}px`;
});

// Column count follows the stream width; Keep uses 240px cards (160px on phones).
const streamRef = ref<HTMLElement | null>(null);
const streamWidth = ref(0);
let resizeObserver: ResizeObserver | null = null;
// Compact mode follows the stream width (not the viewport) so an expanded sidebar can't overflow fixed columns.
const isCompact = computed(() => streamWidth.value > 0 && streamWidth.value < 600);
const columnCount = computed(() => {
  if (viewMode.value === 'list') return 1;
  return columnCountFor(streamWidth.value, isCompact.value ? 160 : 240, isCompact.value ? 8 : 16);
});

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
const pinnedColumns = computed(() => distributeColumns(pinnedThings.value, columnCount.value));
const otherColumns = computed(() => distributeColumns(otherThings.value, columnCount.value));

const loadMoreTrigger = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

type Snackbar = { message: string; undo?: () => Promise<unknown> };
const snackbar = ref<Snackbar | null>(null);
let snackbarTimer: number | null = null;

function showToast(message: string, undo?: () => Promise<unknown>) {
  snackbar.value = { message, undo };
  if (snackbarTimer) clearTimeout(snackbarTimer);
  snackbarTimer = window.setTimeout(dismissSnackbar, undo ? 6000 : 3000);
}

function dismissSnackbar() {
  if (snackbarTimer) clearTimeout(snackbarTimer);
  snackbarTimer = null;
  snackbar.value = null;
}

async function runUndo() {
  const undo = snackbar.value?.undo;
  dismissSnackbar();
  if (!undo) return;
  const failed = await undo();
  if (failed) showToast(String(failed));
}

// Each undo returns an error message, or nothing on success.
async function undoMany(notes: Thing[], reverse: (t: Thing) => Promise<{ success: boolean; error?: string }>) {
  const results = await Promise.all(notes.map(reverse));
  const failure = results.find((r) => !r.success);
  return failure ? (failure.error || "Couldn't undo. Check Archive or Trash.") : undefined;
}


function triggerAuthModal(tab: 'login' | 'register') {
  if (openAuthModal) {
    openAuthModal(tab);
  }
}

async function handleToggleSticky(thing: Thing) {
  const result = await toggleSticky(thing);
  if (!result.success && result.error) showToast(result.error);
}

async function handleTogglePublic(thing: Thing) {
  const result = await togglePublic(thing);
  if (result.success) {
    showToast(thing.public ? 'Note is now private' : 'Note is now public');
  }
}

async function handleToggleArchive(thing: Thing) {
  const result = await toggleArchive(thing);
  if (result.success && result.thing) {
    const changed = result.thing;
    showToast(thing.archived ? 'Note unarchived' : 'Note archived', () => undoMany([changed], undoArchive));
  } else if (result.error) {
    showToast(result.error);
  }
  return result.success;
}

async function handleModalArchive(thing: Thing) {
  if (isModalMutating.value) return;
  isModalMutating.value = true;
  try {
    if (await handleToggleArchive(thing)) closeNoteModal();
  } finally {
    isModalMutating.value = false;
  }
}

async function handleDeleteNote(thing: Thing): Promise<boolean> {
  const result = await deleteNote(thing._id, thing);
  if (result.success) {
    const deleted = result.thing || thing;
    showToast('Note moved to Trash', () => undoMany([deleted], undoDelete));
  } else if (result.error) {
    showToast(result.error);
  }
  return result.success;
}

// Close only after the delete lands, so a failed delete keeps the open draft.
async function handleModalDelete(thing: Thing) {
  if (isModalMutating.value) return;
  isModalMutating.value = true;
  try {
    if (await handleDeleteNote(thing)) closeNoteModal();
  } finally {
    isModalMutating.value = false;
  }
}

const copyingIds = ref(new Set<string>());
async function handleDuplicateNote(thing: Thing) {
  if (copyingIds.value.has(thing._id)) return { success: false, error: 'A copy is already being created' };
  copyingIds.value.add(thing._id);
  showToast('Creating copy…');
  try {
    const result = await duplicateNote(thing);
    showToast(result.success ? 'Copy created in Notes' : result.error || 'Could not create copy. Try again.');
    return result;
  } finally {
    copyingIds.value.delete(thing._id);
  }
}

async function handleRestoreNote(thing: Thing) {
  const result = await restoreNote(thing._id);
  if (result.success) showToast('Note restored');
  else if (result.error) showToast(result.error);
}

const isModalMutating = ref(false);
const isNoteModalOpen = ref(false);
const activeModalNoteId = ref<string | null>(null);
const fallbackModalNote = ref<Thing | null>(null);

const activeModalNote = computed<Thing | null>(() => {
  if (!activeModalNoteId.value) return null;
  return things.value.find((t) => t._id === activeModalNoteId.value) || fallbackModalNote.value;
});

async function saveModalNote(id: string, updates: Partial<Thing>) {
  const result = await updateNote(id, updates, activeModalNote.value || undefined);
  if (result.success && result.thing) fallbackModalNote.value = result.thing;
  return result;
}

function openNoteModal(thing: Thing) {
  if (isSelectionMode.value) {
    handleToggleSelect(thing);
    return;
  }
  activeModalNoteId.value = thing._id;
  fallbackModalNote.value = thing;
  isNoteModalOpen.value = true;
}

function closeNoteModal() {
  isNoteModalOpen.value = false;
  activeModalNoteId.value = null;
  fallbackModalNote.value = null;
}

function handleQueryRemove() {
  const query = { ...route.query };
  delete query.q;
  router.replace({ query });
}

function handleTagClick(tag: string) {
  router.replace({ query: { ...route.query, q: undefined, tag } });
}

function handleWikilinkClick(target: string) {
  router.push({ query: { ...route.query, tag: undefined, q: target } });
}

let lastSyncedFilterKey = '';

function syncRouteFilters(force = false) {
  const q = typeof route.query.q === 'string' ? route.query.q : '';
  const tag = typeof route.query.tag === 'string' ? route.query.tag : null;
  const archived = route.query.archived === '1' || route.query.archived === 'true';
  const deleted = route.query.deleted === '1' || route.query.deleted === 'true';
  const userId = user.value?.id || '';
  const filterKey = `${userId}|${q}|${tag}|${archived}|${deleted}`;
  if (!force && filterKey === lastSyncedFilterKey) return;
  lastSyncedFilterKey = filterKey;
  setFilters({ search: q, tag, archived, deleted });
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
const isBatchDeleting = ref(false);

const isBatchColorSaving = ref(false);
const isBatchUpdating = ref(false);
const isBatchMutating = computed(
  () => isBatchDeleting.value || isBatchColorSaving.value || isBatchUpdating.value
);
const showBatchColorPicker = ref(false);
const batchColorWrapperRef = ref<HTMLDivElement | null>(null);
const batchColorTriggerRef = ref<HTMLButtonElement | null>(null);
const batchColorPaletteRef = ref<HTMLDivElement | null>(null);
const focusedBatchColorIndex = ref(0);

function focusBatchColor(index: number) {
  focusedBatchColorIndex.value = index;
  nextTick(() => {
    batchColorPaletteRef.value?.querySelectorAll<HTMLButtonElement>('.batch-swatch')[index]?.focus();
  });
}

function closeBatchColorPicker(returnFocus = false) {
  showBatchColorPicker.value = false;
  document.removeEventListener('pointerdown', handleOutsideBatchColorPicker);
  if (returnFocus) {
    nextTick(() => {
      batchColorTriggerRef.value?.focus();
    });
  }
}

function toggleBatchColorPicker() {
  if (showBatchColorPicker.value) {
    closeBatchColorPicker();
    return;
  }
  showBatchColorPicker.value = true;
  document.addEventListener('pointerdown', handleOutsideBatchColorPicker);
  focusBatchColor(0);
}

function handleOutsideBatchColorPicker(event: PointerEvent) {
  if (showBatchColorPicker.value && !batchColorWrapperRef.value?.contains(event.target as Node)) {
    closeBatchColorPicker();
  }
}

function handleBatchColorKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeBatchColorPicker(true);
    return;
  }

  const columnCount = 4;
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -columnCount,
    ArrowDown: columnCount,
  };
  if (offsets[event.key] === undefined && event.key !== 'Home' && event.key !== 'End') return;

  event.preventDefault();
  let nextIndex;
  if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = NOTE_COLORS.length - 1;
  else nextIndex = (index + offsets[event.key] + NOTE_COLORS.length) % NOTE_COLORS.length;
  focusBatchColor(nextIndex);
}

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
  closeBatchColorPicker(false);
}

async function handleBatchColor(color: NoteColor) {
  if (isBatchMutating.value || selectedIds.value.size === 0) return;
  isBatchColorSaving.value = true;
  try {
    const ids = Array.from(selectedIds.value);
    const res = await batchUpdateNotes(ids, { color });
    closeBatchColorPicker(true);
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    if (res.success) {
      showToast(`Updated color for ${res.updatedCount} note${res.updatedCount > 1 ? 's' : ''}`);
    } else {
      showToast(`Updated ${res.updatedCount} notes. ${res.failedIds.length} failed.`);
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
      showToast(`${shouldPin ? 'Pinned' : 'Unpinned'} ${res.updatedCount} notes. ${res.failedIds.length} failed.`);
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
    const changed = res.updatedThings;
    if (res.success) {
      showToast(`${shouldArchive ? 'Archived' : 'Unarchived'} ${res.updatedCount} note${res.updatedCount > 1 ? 's' : ''}`, () => undoMany(changed, undoArchive));
    } else {
      showToast(`${shouldArchive ? 'Archived' : 'Restored'} ${res.updatedCount} notes. ${res.failedIds.length} failed.`);
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
    for (const id of res.successfulIds) {
      selectedIds.value.delete(id);
    }
    selectedIds.value = new Set(selectedIds.value);
    const deleted = res.deletedThings;
    if (res.success) {
      showToast(`Moved ${res.deletedCount} note${res.deletedCount > 1 ? 's' : ''} to Trash`, () => undoMany(deleted, undoDelete));
    } else {
      showToast(`Moved ${res.deletedCount} notes to Trash. ${res.failedIds.length} failed.`);
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
    if (showBatchColorPicker.value) {
      closeBatchColorPicker(true);
    } else if (isSelectionMode.value && !isLightboxOpen.value) {
      handleClearSelection();
    }
  }
}

watch(isAuthenticated, (authenticated) => {
  if (!authenticated) {
    lastSyncedFilterKey = '';
    return;
  }
  syncRouteFilters(true);
}, { immediate: true });

watch(
  () => [route.query.q, route.query.tag, route.query.archived, route.query.deleted],
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
  showToast('Notes refreshed after import');
}

watch(streamRef, (el) => {
  resizeObserver?.disconnect();
  if (!el || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(([entry]) => {
    streamWidth.value = entry.contentRect.width;
  });
  resizeObserver.observe(el);
});

onMounted(() => {
  setupIntersectionObserver();
  window.addEventListener('meemo:imported', handleImportEvent);
  window.addEventListener('keydown', handleGlobalKeydown);
});

onUnmounted(() => {
  if (observer) {
    observer.disconnect();
  }
  if (snackbarTimer) clearTimeout(snackbarTimer);
  resizeObserver?.disconnect();
  window.removeEventListener('meemo:imported', handleImportEvent);
  window.removeEventListener('keydown', handleGlobalKeydown);
  document.removeEventListener('pointerdown', handleOutsideBatchColorPicker);
});
</script>

<style scoped>
.notes-view {
  padding: 32px 16px 96px;
}

.notes-view.is-selecting {
  padding-bottom: 12rem;
}

/* Visually hidden by default; mobile shows it for Archive/Trash/label views. */
.workspace-title {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.search-progress-bar {
  position: relative;
  width: 100%;
  height: 3px;
  background-color: var(--md-sys-color-surface-container-high, rgba(0, 0, 0, 0.08));
  overflow: hidden;
  border-radius: 2px;
  margin-bottom: 0.75rem;
}

.search-progress-bar .progress-indicator {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  width: 40%;
  background-color: var(--md-sys-color-primary);
  border-radius: 2px;
  animation: search-indeterminate 1.2s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}

@keyframes search-indeterminate {
  0% {
    left: -40%;
  }
  100% {
    left: 100%;
  }
}

.notes-card-list.is-refreshing {
  opacity: 0.75;
  transition: opacity 0.15s ease;
}

@media (prefers-reduced-motion: reduce) {
  .search-progress-bar .progress-indicator {
    animation: none;
    width: 100%;
    opacity: 0.6;
  }
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
  max-width: 560px;
  margin: 3rem auto 0;
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

.hero-icon .ui-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: var(--md-sys-color-primary);
}

.auth-hero h1 {
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


/* Search results banner */
.active-filter-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  max-width: 600px;
  margin: 0 auto 1.5rem;
  font-size: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.filter-label {
  overflow-wrap: anywhere;
}

.clear-all-link {
  min-height: 36px;
  padding: 0 0.75rem;
  border: none;
  border-radius: var(--md-sys-shape-corner-xs);
  background: none;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  cursor: pointer;
}

.clear-all-link:hover {
  background: var(--md-sys-state-hover);
}

.error-banner {
  max-width: 600px;
  margin: 0 auto 1rem;
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  padding: 0.75rem 1rem;
  border-radius: var(--keep-card-radius);
}

/* Keep-style snackbar */
.snackbar {
  position: fixed;
  left: 24px;
  bottom: 24px;
  z-index: 700;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 288px;
  max-width: min(568px, calc(100vw - 48px));
  min-height: 48px;
  padding: 6px 8px 6px 24px;
  border-radius: 4px;
  background: var(--keep-snackbar);
  color: var(--keep-on-snackbar);
  font-size: var(--md-sys-typescale-body-medium);
  box-shadow: 0 3px 5px -1px rgba(0, 0, 0, 0.2), 0 6px 10px 0 rgba(0, 0, 0, 0.14), 0 1px 18px 0 rgba(0, 0, 0, 0.12);
}

.snackbar-text {
  flex: 1;
  padding: 8px 0;
}

.snackbar-action {
  min-height: 36px;
  padding: 0 12px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--keep-accent);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  letter-spacing: 0.0178em;
  cursor: pointer;
}

:root[data-theme="dark"] .snackbar-action {
  color: #8a5a00;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .snackbar-action {
    color: #8a5a00;
  }
}

.snackbar-action:hover,
.snackbar-close:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}

.snackbar-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.snackbar-enter-active,
.snackbar-leave-active {
  transition: transform var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              opacity var(--md-sys-motion-duration-medium) ease;
}

.snackbar-enter-from,
.snackbar-leave-to {
  transform: translateY(16px);
  opacity: 0;
}

/* Layout */
.stream-column {
  min-width: 0;
  width: 100%;
}

/* Row-order masonry: fixed 240px Keep columns, centered. */
.m3-notes-masonry {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  gap: 16px;
}

.masonry-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 240px;
  min-width: 0;
}

.m3-notes-masonry.is-compact,
.m3-notes-masonry.is-compact .masonry-column {
  gap: 8px;
}

.m3-notes-masonry.is-compact .masonry-column {
  flex: 1 1 0;
  width: auto;
}

.m3-notes-masonry.is-list .masonry-column {
  width: 100%;
  max-width: 600px;
}

.notes-section + .notes-section {
  margin-top: 32px;
}

.section-label {
  max-width: var(--grid-width, 100%);
  margin: 0 auto 8px;
  padding-left: 12px;
  font-size: var(--md-sys-typescale-label-small);
  font-weight: 600;
  letter-spacing: 0.08em;
  line-height: 1rem;
  text-transform: uppercase;
  color: var(--md-sys-color-on-surface-variant);
  user-select: none;
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

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18vh 1.5rem 3rem;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
}

.empty-icon .ui-icon {
  width: 120px;
  height: 120px;
  stroke-width: 1;
  margin-bottom: 1.25rem;
  opacity: 0.25;
  color: var(--md-sys-color-on-surface);
}

.empty-state h2 {
  font-size: var(--md-sys-typescale-title-large);
  font-weight: 400;
  color: var(--md-sys-color-on-surface-variant);
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
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  padding: 0.5rem 1rem;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  box-shadow: var(--md-sys-elevation-3);
  border: 1px solid var(--md-sys-color-outline-variant);
  max-width: 90vw;
}

.batch-bar-leading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}

.batch-count {
  font-size: 0.9rem;
  font-weight: 600;
  white-space: nowrap;
}

.batch-text-btn {
  min-height: 44px;
  background: none;
  border: none;
  color: var(--md-sys-color-primary);
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
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 1.1rem;
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.batch-btn:hover {
  background-color: var(--md-sys-color-surface-container);
}

.batch-btn.active {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.batch-delete-btn:hover {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
}

/* Batch Color Picker */
.batch-color-wrapper {
  position: relative;
}

.batch-color-palette {
  position: absolute;
  bottom: 50px;
  left: 0;
  background-color: var(--md-sys-color-surface-container-high);
  padding: 8px;
  border-radius: 16px;
  display: grid;
  grid-template-columns: repeat(4, 44px);
  gap: 4px;
  box-shadow: var(--md-sys-elevation-3, 0 4px 14px rgba(0, 0, 0, 0.25));
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.12));
  z-index: 600;
}

.batch-swatch {
  width: 44px;
  height: 44px;
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

@media (max-width: 599px) {
  .notes-view {
    padding: 16px 8px 96px;
  }

  .snackbar {
    left: 8px;
    right: 8px;
    bottom: max(8px, env(safe-area-inset-bottom));
    min-width: 0;
    max-width: none;
  }
}

@media (max-width: 767px) {
  .workspace-title.is-named-view {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip-path: none;
    margin: 0 8px 16px;
    font-size: var(--md-sys-typescale-title-large);
    font-weight: 400;
    color: var(--md-sys-color-on-surface-variant);
  }
}

@media (max-width: 640px) {

  .batch-action-bar {
    bottom: max(1rem, env(safe-area-inset-bottom));
    width: calc(100% - 2rem);
    max-width: 400px;
    padding: 0.5rem;
    flex-direction: column;
    gap: 0.25rem;
    border-radius: var(--md-sys-shape-corner-xl);
  }

  .batch-bar-leading,
  .batch-bar-actions {
    width: 100%;
    justify-content: space-between;
  }

  .batch-text-btn {
    margin-left: auto;
  }

  .batch-bar-actions {
    border-top: 1px solid var(--md-sys-color-outline-variant);
    padding-top: 0.25rem;
  }
}
</style>
