<template>
  <Teleport to="body">
    <Transition name="note-modal-fade">
      <div
        v-if="open && thing"
        ref="overlayRef"
        class="note-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Note details"
        tabindex="-1"
        @click="handleBackdropClick"
        @keydown="handleWindowKeydown"
      >
        <div
          class="note-modal-card"
          :class="{
            'is-sticky': currentNote.sticky,
            'is-archived': currentNote.archived
          }"
          :style="{ backgroundColor: 'var(--note-color-' + (currentNote.color || 'default') + ')' }"
          @click.stop
        >
          <!-- Modal Top Header -->
          <header class="modal-header">
            <div class="header-meta">
              <time :datetime="isoDate" :title="fullDate" class="note-time">
                {{ relativeDate }}
              </time>
              <span v-if="currentNote.sticky" class="badge badge-sticky" title="Pinned to top">
                📌 Pinned
              </span>
              <span v-if="currentNote.public" class="badge badge-public" title="Visible on public stream">
                🌐 Public
              </span>
              <span v-if="currentNote.shared" class="badge badge-shared" title="Directly shared">
                🔗 Shared
              </span>
              <span v-if="currentNote.archived" class="badge badge-archived" title="Archived note">
                📦 Archived
              </span>
            </div>

            <div class="header-actions">
              <!-- View / Edit Segmented Mode Toggle (when editable) -->
              <div v-if="canEdit" class="mode-toggle-group" role="tablist" aria-label="Note view or edit mode">
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: currentMode === 'view' }"
                  role="tab"
                  :aria-selected="currentMode === 'view'"
                  title="View formatted markdown"
                  @click="switchToView"
                >
                  <span class="mode-icon">👁️</span>
                  <span class="mode-text">Preview</span>
                </button>
                <button
                  type="button"
                  class="mode-btn"
                  :class="{ active: currentMode === 'edit' }"
                  role="tab"
                  :aria-selected="currentMode === 'edit'"
                  title="Edit markdown"
                  @click="switchToEdit"
                >
                  <span class="mode-icon">✏️</span>
                  <span class="mode-text">Edit</span>
                </button>
              </div>

              <!-- Pin toggle button -->
              <button
                v-if="canEdit"
                type="button"
                class="icon-btn pin-btn"
                :class="{ active: currentNote.sticky }"
                :title="currentNote.sticky ? 'Unpin note' : 'Pin note to top'"
                :aria-label="currentNote.sticky ? 'Unpin note' : 'Pin note to top'"
                :aria-pressed="Boolean(currentNote.sticky)"
                @click="togglePin"
              >
                📌
              </button>

              <!-- Close button (top right) -->
              <button
                type="button"
                class="icon-btn close-btn"
                title="Close (Esc)"
                aria-label="Close note modal"
                @click="closeWithSave"
              >
                ✕
              </button>
            </div>
          </header>

          <!-- Error Alert Banner -->
          <div v-if="actionError" class="modal-error-banner" role="alert">
            {{ actionError }}
          </div>

          <!-- Modal Scrollable Content Body -->
          <main class="modal-body">
            <!-- View / Rendered Mode -->
            <div
              v-if="currentMode === 'view'"
              ref="renderedBodyRef"
              class="modal-markdown-body markdown-body"
              :class="{ 'can-click-to-edit': canEdit }"
              :title="canEdit ? 'Double-click or click to edit note' : undefined"
              v-html="renderedHtml"
              @click="handleBodyClick"
            ></div>

            <!-- Edit Mode -->
            <div v-else class="modal-editor-container">
              <textarea
                ref="textareaRef"
                v-model="editDraft"
                class="modal-textarea"
                placeholder="Note content (Markdown supported)..."
                rows="12"
                @keydown="handleTextareaKeydown"
                @input="handleTextareaInput"
              ></textarea>
              <div class="editor-hint">
                <kbd>Ctrl+S</kbd> or <kbd>Ctrl+Enter</kbd> to save, <kbd>Esc</kbd> to close & auto-save
              </div>
            </div>

            <!-- Attachments Display -->
            <div v-if="currentNote.attachments && currentNote.attachments.length > 0" class="modal-attachments">
              <h4 class="section-title">Attachments ({{ currentNote.attachments.length }})</h4>
              <div class="attachment-grid">
                <div
                  v-for="att in currentNote.attachments"
                  :key="att.identifier"
                  class="attachment-card"
                >
                  <a
                    :href="attachmentUrl(att)"
                    target="_blank"
                    rel="noopener"
                    class="attachment-anchor"
                    @click="handleAttachmentClick($event, att)"
                  >
                    <span class="att-icon">{{ isImageAttachment(att) ? '🖼️' : '📎' }}</span>
                    <div class="att-info">
                      <span class="att-name" :title="att.fileName || att.identifier">
                        {{ att.fileName || att.identifier }}
                      </span>
                      <span v-if="att.size" class="att-size">{{ formatFileSize(att.size) }}</span>
                    </div>
                  </a>
                </div>
              </div>
            </div>

            <!-- Tags Display -->
            <div v-if="currentNote.tags && currentNote.tags.length > 0" class="modal-tags">
              <div class="tags-container">
                <button
                  v-for="tag in currentNote.tags"
                  :key="tag"
                  type="button"
                  class="tag-pill"
                  :title="`Filter by #${tag}`"
                  @click="handleTagClick(tag)"
                >
                  #{{ tag }}
                </button>
              </div>
            </div>
          </main>

          <!-- Modal Footer (Action Bar - Google Keep Style) -->
          <footer class="modal-footer">
            <div v-if="canEdit" class="footer-actions">
              <!-- Color Picker Popover -->
              <div ref="colorWrapperRef" class="color-picker-wrapper">
                <button
                  ref="colorTriggerRef"
                  type="button"
                  class="action-btn color-btn"
                  :class="{ active: showColorPicker }"
                  title="Note color"
                  aria-label="Note color"
                  aria-haspopup="true"
                  :aria-expanded="showColorPicker"
                  :disabled="isColorSaving"
                  @click="toggleColorPicker"
                >
                  🎨
                </button>
                <div
                  v-if="showColorPicker"
                  ref="colorPaletteRef"
                  class="color-palette-popover"
                  role="group"
                  aria-label="Note modal color"
                >
                  <button
                    v-for="(c, index) in NOTE_COLORS"
                    :key="c.key"
                    type="button"
                    class="color-swatch-btn"
                    :class="{ active: (currentNote.color || 'default') === c.key }"
                    :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
                    :title="c.name"
                    :aria-label="c.name"
                    :aria-pressed="(currentNote.color || 'default') === c.key"
                    :aria-disabled="isColorSaving"
                    :tabindex="focusedColorIndex === index ? 0 : -1"
                    @click="selectColor(c.key)"
                    @keydown="handleColorKeydown($event, index)"
                  ></button>
                </div>
              </div>

              <!-- Public Toggle -->
              <button
                type="button"
                class="action-btn"
                :class="{ active: currentNote.public }"
                :title="currentNote.public ? 'Make note private' : 'Make note public'"
                :aria-label="currentNote.public ? 'Make note private' : 'Make note public'"
                @click="togglePublic"
              >
                🌐
              </button>

              <!-- Archive Toggle -->
              <button
                type="button"
                class="action-btn"
                :class="{ active: currentNote.archived }"
                :title="currentNote.archived ? 'Restore note from archive' : 'Archive note'"
                :aria-label="currentNote.archived ? 'Restore note from archive' : 'Archive note'"
                @click="toggleArchive"
              >
                {{ currentNote.archived ? '↩️' : '📦' }}
              </button>

              <!-- Delete Button -->
              <button
                type="button"
                class="action-btn delete-btn"
                title="Move note to trash"
                aria-label="Move note to trash"
                @click="showDeleteConfirm = true"
              >
                🗑️
              </button>
            </div>
            <div v-else class="footer-placeholder"></div>

            <!-- Right side: Status and Close/Done Button -->
            <div class="footer-right">
              <span v-if="isSaving" class="save-status saving">Saving...</span>
              <span v-else-if="hasUnsavedChanges" class="save-status unsaved">Unsaved changes</span>

              <button
                type="button"
                class="done-btn"
                :disabled="isSaving"
                @click="closeWithSave"
              >
                Close
              </button>
            </div>
          </footer>

          <!-- Delete Confirmation Dialog -->
          <div
            v-if="showDeleteConfirm"
            class="delete-confirm-overlay"
            role="dialog"
            aria-modal="true"
            @click.self="showDeleteConfirm = false"
          >
            <div class="delete-confirm-card">
              <h3>Move note to trash?</h3>
              <p>This note can be restored from Trash.</p>
              <div class="delete-confirm-actions">
                <button
                  type="button"
                  class="btn-cancel"
                  :disabled="isDeleting"
                  @click="showDeleteConfirm = false"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn-delete"
                  :disabled="isDeleting"
                  @click="confirmDelete"
                >
                  <span v-if="isDeleting">Deleting...</span>
                  <span v-else>Move to Trash</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import type { Thing, AttachmentDescriptor, NoteColor } from '../api/client';
import { NOTE_COLORS } from '../constants/noteColors';
import { renderMarkdown, highlightKeyword, toggleTaskItem } from '../utils/markdown';
import type { LightboxImage } from './ImageLightbox.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    thing: Thing | null;
    canEdit?: boolean;
    initialMode?: 'view' | 'edit';
    highlightQuery?: string;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; thing?: Thing; error?: string }>;
    onDeleteConfirm?: (id: string) => Promise<{ success: boolean; error?: string }>;
  }>(),
  {
    canEdit: true,
    initialMode: 'view',
    highlightQuery: '',
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update', id: string, updates: Partial<Thing>): void;
  (e: 'toggleSticky', thing: Thing): void;
  (e: 'togglePublic', thing: Thing): void;
  (e: 'toggleArchive', thing: Thing): void;
  (e: 'delete', id: string): void;
  (e: 'tagClick', tag: string): void;
  (e: 'wikilinkClick', target: string): void;
  (e: 'imageClick', images: LightboxImage[], index: number): void;
}>();

const currentNote = ref<Thing>({
  _id: '',
  ownerId: '',
  content: '',
  richContent: '',
  createdAt: Date.now(),
  modifiedAt: Date.now(),
  revision: 1,
  tags: [],
  attachments: [],
  public: false,
  shared: false,
  archived: false,
  sticky: false,
  color: 'default',
});

const currentMode = ref<'view' | 'edit'>('view');
const editDraft = ref('');
const isSaving = ref(false);
const isDeleting = ref(false);
const isColorSaving = ref(false);
const isTaskSaving = ref(false);
const actionError = ref<string | null>(null);
let draftGeneration = 0;

const showColorPicker = ref(false);
const focusedColorIndex = ref(0);
const showDeleteConfirm = ref(false);

const overlayRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const renderedBodyRef = ref<HTMLElement | null>(null);
const colorWrapperRef = ref<HTMLElement | null>(null);
const colorTriggerRef = ref<HTMLButtonElement | null>(null);
const colorPaletteRef = ref<HTMLElement | null>(null);

const hasUnsavedChanges = computed(() => {
  if (!props.canEdit || !currentNote.value) return false;
  return editDraft.value !== (currentNote.value.content || '');
});

const dateValue = computed(() => {
  return currentNote.value.modifiedAt || currentNote.value.createdAt || Date.now();
});

const isoDate = computed(() => {
  return new Date(dateValue.value).toISOString();
});

const fullDate = computed(() => {
  return new Date(dateValue.value).toLocaleString();
});

const relativeDate = computed(() => {
  const d = new Date(dateValue.value);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0 || isNaN(diffMs)) return d.toLocaleDateString();

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
});

const renderedHtml = computed(() => {
  const raw = currentMode.value === 'view'
    ? (currentNote.value.richContent || currentNote.value.content || '')
    : editDraft.value;
  const html = renderMarkdown(raw);
  return props.highlightQuery ? highlightKeyword(html, props.highlightQuery) : html;
});

function isImageAttachment(att: AttachmentDescriptor): boolean {
  if (att.type === 'image') return true;
  if (att.mime?.startsWith('image/')) return true;
  const name = att.fileName?.toLowerCase() || '';
  return /\.(png|jpe?g|gif|webp|svg)$/.test(name);
}

function attachmentUrl(att: AttachmentDescriptor): string {
  return `/api/files/${currentNote.value.ownerId || 'me'}/${currentNote.value._id}/${att.identifier}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function collectImages(): LightboxImage[] {
  const images: LightboxImage[] = [];
  if (renderedBodyRef.value) {
    const imgs = renderedBodyRef.value.querySelectorAll<HTMLImageElement>('img');
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src) {
        images.push({
          src,
          alt: img.getAttribute('alt') || '',
          title: img.getAttribute('title') || img.getAttribute('alt') || '',
        });
      }
    });
  }
  if (currentNote.value.attachments && currentNote.value.attachments.length > 0) {
    for (const att of currentNote.value.attachments) {
      if (isImageAttachment(att)) {
        const src = attachmentUrl(att);
        if (!images.some((i) => i.src === src)) {
          images.push({
            src,
            alt: att.fileName || att.identifier,
            title: att.fileName || att.identifier,
          });
        }
      }
    }
  }
  return images;
}

const instance = getCurrentInstance();
const hasImageClickListener = computed(() => Boolean(instance?.vnode.props?.onImageClick));
const hasStickyListener = computed(() => Boolean(instance?.vnode.props?.onToggleSticky));
const hasPublicListener = computed(() => Boolean(instance?.vnode.props?.onTogglePublic));
const hasArchiveListener = computed(() => Boolean(instance?.vnode.props?.onToggleArchive));

function handleAttachmentClick(event: MouseEvent, att: AttachmentDescriptor) {
  if (hasImageClickListener.value && isImageAttachment(att) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    const images = collectImages();
    const src = attachmentUrl(att);
    const index = images.findIndex((img) => img.src === src);
    emit('imageClick', images, index >= 0 ? index : 0);
  }
}

async function handleBodyClick(event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
  const targetEl = event.target as HTMLElement | null;
  if (!targetEl) return;

  // 1. Task checkbox toggle
  const checkbox = targetEl.closest<HTMLInputElement>('.task-list-item-checkbox');
  if (checkbox) {
    event.stopPropagation();
    if (!props.canEdit || isTaskSaving.value) {
      event.preventDefault();
      return;
    }
    const rawIndex = checkbox.dataset.taskIndex;
    if (rawIndex === undefined) return;
    const taskIndex = parseInt(rawIndex, 10);
    if (isNaN(taskIndex)) return;

    const currentContent = currentNote.value.content || '';
    const updatedContent = toggleTaskItem(currentContent, taskIndex);
    if (updatedContent === currentContent) return;

    const wasChecked = !checkbox.checked;
    isTaskSaving.value = true;
    actionError.value = null;

    try {
      if (props.onSaveEdit) {
        const result = await props.onSaveEdit(currentNote.value._id, { content: updatedContent });
        if (result.success) {
          if (result.thing) currentNote.value = { ...result.thing };
          else currentNote.value.content = updatedContent;
          editDraft.value = currentNote.value.content || '';
        } else {
          checkbox.checked = wasChecked;
          actionError.value = result.error || 'Failed to update task';
        }
      } else {
        emit('update', currentNote.value._id, { content: updatedContent });
        currentNote.value.content = updatedContent;
        editDraft.value = updatedContent;
      }
    } catch (err: any) {
      checkbox.checked = wasChecked;
      actionError.value = err.message || 'Failed to update task';
    } finally {
      isTaskSaving.value = false;
    }
    return;
  }

  // 2. Image preview click
  const imgTarget = targetEl.closest('img');
  if (imgTarget && hasImageClickListener.value) {
    const anchor = imgTarget.closest('a');
    if (!anchor) {
      event.preventDefault();
      event.stopPropagation();
      const images = collectImages();
      const src = imgTarget.getAttribute('src') || '';
      const index = images.findIndex((img) => img.src === src);
      emit('imageClick', images, index >= 0 ? index : 0);
      return;
    }
  }

  // 3. Anchor links (wikilinks or tag searches)
  const anchor = targetEl.closest('a');
  if (anchor) {
    if (anchor.classList.contains('wikilink') || anchor.dataset.wikilink) {
      event.preventDefault();
      const query = anchor.dataset.wikilink || anchor.textContent?.trim() || '';
      if (query) {
        closeWithSave();
        emit('wikilinkClick', query);
      }
      return;
    }

    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#search?#')) {
      event.preventDefault();
      const tag = href.replace('#search?#', '').trim();
      if (tag) {
        closeWithSave();
        emit('tagClick', tag);
      }
      return;
    }
    return;
  }

  // 4. Clicking the content area in view mode enters edit mode (Google Keep style)
  if (props.canEdit && currentMode.value === 'view') {
    switchToEdit();
  }
}

function handleTagClick(tag: string) {
  closeWithSave();
  emit('tagClick', tag);
}

function switchToView() {
  currentMode.value = 'view';
}

function switchToEdit() {
  if (!props.canEdit) return;
  currentMode.value = 'edit';
  nextTick(() => {
    textareaRef.value?.focus();
  });
}

function handleTextareaInput() {
  draftGeneration++;
  actionError.value = null;
}

function handleTextareaKeydown(e: KeyboardEvent) {
  if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || ((e.ctrlKey || e.metaKey) && e.key === 's')) {
    e.preventDefault();
    saveContent();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeWithSave();
  }
}

async function saveContent(): Promise<boolean> {
  if (!props.canEdit || isSaving.value || !currentNote.value) return false;
  const trimmed = editDraft.value.trim();
  if (!trimmed) {
    actionError.value = 'Note content cannot be empty';
    return false;
  }

  if (trimmed === (currentNote.value.content || '')) {
    return true;
  }

  isSaving.value = true;
  actionError.value = null;
  const saveGeneration = draftGeneration;

  try {
    if (props.onSaveEdit) {
      const result = await props.onSaveEdit(currentNote.value._id, { content: trimmed });
      if (result.success) {
        if (result.thing) currentNote.value = { ...result.thing };
        else currentNote.value.content = trimmed;
        if (saveGeneration === draftGeneration) {
          editDraft.value = currentNote.value.content || '';
        }
        return true;
      } else {
        actionError.value = result.error || 'Failed to save note';
        return false;
      }
    } else {
      emit('update', currentNote.value._id, { content: trimmed });
      currentNote.value.content = trimmed;
      return true;
    }
  } catch (err: any) {
    actionError.value = err.message || 'Failed to save note';
    return false;
  } finally {
    isSaving.value = false;
  }
}

const isClosing = ref(false);

async function closeWithSave() {
  if (isClosing.value || isSaving.value) return;
  isClosing.value = true;
  try {
    if (hasUnsavedChanges.value && editDraft.value.trim()) {
      const saved = await saveContent();
      if (!saved) {
        // Save failed — keep modal open so user can retry or discard
        return;
      }
    }
    emit('close');
  } finally {
    isClosing.value = false;
  }
}

function handleBackdropClick() {
  closeWithSave();
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    if (showColorPicker.value) {
      closeColorPicker(true);
      return;
    }
    if (showDeleteConfirm.value) {
      showDeleteConfirm.value = false;
      return;
    }
    event.preventDefault();
    closeWithSave();
  }
}

// Color Picker
function focusColor(index: number) {
  focusedColorIndex.value = index;
  nextTick(() => {
    colorPaletteRef.value?.querySelectorAll<HTMLButtonElement>('.color-swatch-btn')[index]?.focus();
  });
}

function closeColorPicker(returnFocus = false) {
  showColorPicker.value = false;
  document.removeEventListener('pointerdown', handleOutsideColorPicker);
  if (returnFocus) nextTick(() => colorTriggerRef.value?.focus());
}

function toggleColorPicker() {
  if (showColorPicker.value) {
    closeColorPicker();
    return;
  }
  actionError.value = null;
  showColorPicker.value = true;
  document.addEventListener('pointerdown', handleOutsideColorPicker);
  const selected = NOTE_COLORS.findIndex((color) => color.key === (currentNote.value.color || 'default'));
  focusColor(selected < 0 ? 0 : selected);
}

function handleOutsideColorPicker(event: PointerEvent) {
  if (showColorPicker.value && !colorWrapperRef.value?.contains(event.target as Node)) {
    closeColorPicker();
  }
}

function handleColorKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeColorPicker(true);
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
  focusColor(nextIndex);
}

async function selectColor(color: NoteColor) {
  if (isColorSaving.value || !currentNote.value) return;
  if (color === (currentNote.value.color || 'default')) {
    closeColorPicker(true);
    return;
  }
  actionError.value = null;
  isColorSaving.value = true;

  try {
    if (props.onSaveEdit) {
      const result = await props.onSaveEdit(currentNote.value._id, { color });
      if (result.success) {
        if (result.thing) currentNote.value = { ...result.thing };
        else currentNote.value.color = color;
        closeColorPicker(true);
      } else {
        actionError.value = result.error || 'Failed to update note color';
      }
    } else {
      emit('update', currentNote.value._id, { color });
      currentNote.value.color = color;
      closeColorPicker(true);
    }
  } catch (err: any) {
    actionError.value = err.message || 'Failed to update color';
  } finally {
    isColorSaving.value = false;
  }
}

// Action Toggles
async function togglePin() {
  if (!currentNote.value || !props.canEdit) return;
  if (hasStickyListener.value) {
    emit('toggleSticky', props.thing || currentNote.value);
    return;
  }
  const nextSticky = !currentNote.value.sticky;
  actionError.value = null;
  if (props.onSaveEdit) {
    const res = await props.onSaveEdit(currentNote.value._id, { sticky: nextSticky });
    if (res.success) {
      if (res.thing) currentNote.value = { ...res.thing };
      else currentNote.value.sticky = nextSticky;
    } else {
      actionError.value = res.error || 'Failed to update pin';
    }
  } else {
    emit('toggleSticky', props.thing || currentNote.value);
  }
}

async function togglePublic() {
  if (!currentNote.value || !props.canEdit) return;
  if (hasPublicListener.value) {
    emit('togglePublic', props.thing || currentNote.value);
    return;
  }
  const nextPublic = !currentNote.value.public;
  actionError.value = null;
  if (props.onSaveEdit) {
    const res = await props.onSaveEdit(currentNote.value._id, { public: nextPublic });
    if (res.success) {
      if (res.thing) currentNote.value = { ...res.thing };
      else currentNote.value.public = nextPublic;
    } else {
      actionError.value = res.error || 'Failed to update public status';
    }
  } else {
    emit('togglePublic', props.thing || currentNote.value);
  }
}

async function toggleArchive() {
  if (!currentNote.value || !props.canEdit) return;
  if (hasArchiveListener.value) {
    emit('toggleArchive', props.thing || currentNote.value);
    return;
  }
  const nextArchived = !currentNote.value.archived;
  actionError.value = null;
  if (props.onSaveEdit) {
    const res = await props.onSaveEdit(currentNote.value._id, { archived: nextArchived });
    if (res.success) {
      if (res.thing) currentNote.value = { ...res.thing };
      else currentNote.value.archived = nextArchived;
    } else {
      actionError.value = res.error || 'Failed to update archive status';
    }
  } else {
    emit('toggleArchive', props.thing || currentNote.value);
  }
}

async function confirmDelete() {
  if (!currentNote.value) return;
  isDeleting.value = true;
  actionError.value = null;
  try {
    if (props.onDeleteConfirm) {
      const res = await props.onDeleteConfirm(currentNote.value._id);
      if (res.success) {
        showDeleteConfirm.value = false;
        emit('close');
      } else {
        actionError.value = res.error || 'Failed to delete note';
      }
    } else {
      emit('delete', currentNote.value._id);
      showDeleteConfirm.value = false;
      emit('close');
    }
  } catch (err: any) {
    actionError.value = err.message || 'Failed to delete note';
  } finally {
    isDeleting.value = false;
  }
}

// Lifecycle and Sync
watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleWindowKeydown);
      if (props.thing) {
        currentNote.value = { ...props.thing };
        editDraft.value = props.thing.content || '';
        draftGeneration = 0;
        currentMode.value = props.initialMode || 'view';
        if (currentMode.value === 'edit') {
          nextTick(() => textareaRef.value?.focus());
        } else {
          nextTick(() => overlayRef.value?.focus());
        }
      }
    } else {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleWindowKeydown);
      closeColorPicker();
      showDeleteConfirm.value = false;
      actionError.value = null;
      isClosing.value = false;
      isSaving.value = false;
    }
  },
  { immediate: true }
);

watch(
  () => props.thing,
  (newThing) => {
    if (newThing && props.open) {
      currentNote.value = { ...newThing };
      // Only overwrite edit draft if user has not typed unsaved changes
      if (!hasUnsavedChanges.value) {
        editDraft.value = newThing.content || '';
      }
    }
  },
  { deep: true }
);

onUnmounted(() => {
  document.body.style.overflow = '';
  window.removeEventListener('keydown', handleWindowKeydown);
  document.removeEventListener('pointerdown', handleOutsideColorPicker);
});
</script>

<style scoped>
/* Backdrop Overlay */
.note-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background-color: var(--md-sys-color-scrim);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
}

/* Modal Card */
.note-modal-card {
  width: min(720px, 94vw);
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background-color: var(--note-color-default);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--note-border-color);
  border-radius: var(--md-sys-shape-corner-2xl);
  box-shadow: var(--md-sys-elevation-3);
  position: relative;
  overflow: hidden;
  transition: background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              border-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-modal-card.is-sticky {
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 45%, transparent);
}

.note-modal-card.is-archived {
  opacity: 0.92;
}

/* Header */
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem 0.75rem 1.5rem;
  border-bottom: 1px solid var(--note-border-color);
  gap: 0.75rem;
  flex-wrap: wrap;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.note-time {
  font-size: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.badge {
  font-size: var(--md-sys-typescale-label-medium);
  padding: 0.2rem 0.6rem;
  border-radius: var(--md-sys-shape-corner-sm);
  font-weight: 500;
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

.badge-sticky {
  background-color: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}

.badge-public {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.badge-shared {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.badge-archived {
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* Mode Toggle Group (M3 segmented button) */
.mode-toggle-group {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  padding: 2px;
  gap: 2px;
  margin-right: 0.25rem;
}

.mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  min-height: 32px;
  padding: 0.25rem 0.875rem;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  border-radius: var(--md-sys-shape-corner-full);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.mode-btn:hover {
  background: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

.mode-btn.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.icon-btn,
.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: var(--md-sys-shape-corner-full);
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 1rem;
  color: var(--md-sys-color-on-surface-variant);
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.icon-btn:hover,
.action-btn:hover {
  background-color: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

.icon-btn:active,
.action-btn:active {
  background-color: var(--md-sys-state-pressed);
}

.icon-btn.pin-btn.active,
.action-btn.active {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.action-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.close-btn {
  font-size: 1.1rem;
}

/* Error Banner */
.modal-error-banner {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  padding: 0.6rem 1.5rem;
  font-size: var(--md-sys-typescale-body-medium);
  font-weight: 500;
}

/* Modal Body */
.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.modal-markdown-body {
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.65;
  word-break: break-word;
  min-height: 120px;
}

.modal-markdown-body.can-click-to-edit {
  cursor: text;
}

/* Editor Container */
.modal-editor-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  flex: 1;
}

.modal-textarea {
  width: 100%;
  min-height: 280px;
  padding: 0.5rem 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.65;
  resize: vertical;
}

.modal-textarea::placeholder {
  color: var(--md-sys-color-on-surface-variant);
}

.modal-textarea:disabled {
  opacity: 0.6;
}

.editor-hint {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.editor-hint kbd {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0.1rem 0.4rem;
  font-family: var(--md-sys-typescale-font-mono);
  font-size: var(--md-sys-typescale-label-small);
}

/* Attachments */
.modal-attachments {
  border-top: 1px solid var(--note-border-color);
  padding-top: 1rem;
}

.section-title {
  font-size: var(--md-sys-typescale-label-medium);
  font-weight: 600;
  margin: 0 0 0.75rem 0;
  color: var(--md-sys-color-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.attachment-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 0.75rem;
}

.attachment-card {
  border: 1px solid var(--note-border-color);
  border-radius: var(--md-sys-shape-corner-md);
  background: color-mix(in srgb, var(--md-sys-color-surface-container) 55%, transparent);
  transition: background-color var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

.attachment-card:hover {
  background: var(--md-sys-color-surface-container);
  border-color: var(--note-border-hover);
}

.attachment-anchor {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.8rem;
  text-decoration: none;
  color: inherit;
  border-radius: inherit;
}

.att-icon {
  font-size: 1.25rem;
  flex-shrink: 0;
}

.att-info {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.att-name {
  font-size: var(--md-sys-typescale-body-medium);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.att-size {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

/* Tags */
.modal-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tag-pill {
  border: none;
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  padding: 0.25rem 0.75rem;
  border-radius: var(--md-sys-shape-corner-sm);
  font-size: var(--md-sys-typescale-label-large);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.tag-pill:hover {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

/* Footer (Google Keep Style) */
.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.625rem 1rem 0.625rem 1.25rem;
  border-top: 1px solid var(--note-border-color);
  gap: 1rem;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.action-btn.delete-btn:hover {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.color-picker-wrapper {
  position: relative;
}

.color-palette-popover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 1050;
  display: grid;
  grid-template-columns: repeat(4, 32px);
  gap: 8px;
  padding: 12px;
  background-color: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-lg);
  box-shadow: var(--md-sys-elevation-2);
}

.color-swatch-btn {
  width: 32px;
  height: 32px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  cursor: pointer;
  transition: transform var(--md-sys-motion-duration-short) var(--md-sys-motion-easing),
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.color-swatch-btn:hover {
  transform: scale(1.1);
  box-shadow: var(--md-sys-elevation-1);
}

.color-swatch-btn.active {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 0 0 2px var(--md-sys-color-surface-container), 0 0 0 4px var(--md-sys-color-primary);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.save-status {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.save-status.unsaved {
  color: var(--md-sys-color-error);
}

.save-status.saving {
  color: var(--md-sys-color-primary);
}

.done-btn {
  min-height: 40px;
  padding: 0.5rem 1.5rem;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 600;
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short) ease,
              filter var(--md-sys-motion-duration-short) ease;
}

.done-btn:hover {
  box-shadow: var(--md-sys-elevation-1);
  filter: brightness(0.97);
}

.done-btn:disabled {
  opacity: 0.38;
  cursor: not-allowed;
  box-shadow: none;
}

/* Delete Confirm Overlay */
.delete-confirm-overlay {
  position: absolute;
  inset: 0;
  z-index: 1020;
  background: var(--md-sys-color-scrim);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.delete-confirm-card {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  padding: 1.5rem;
  border-radius: var(--md-sys-shape-corner-2xl);
  max-width: 400px;
  box-shadow: var(--md-sys-elevation-3);
}

.delete-confirm-card h3 {
  margin: 0 0 0.5rem 0;
  font-size: var(--md-sys-typescale-headline-small);
  font-weight: 400;
}

.delete-confirm-card p {
  margin: 0 0 1.5rem 0;
  font-size: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.delete-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-cancel,
.btn-delete {
  min-height: 40px;
  padding: 0.5rem 1.25rem;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.btn-cancel {
  border: none;
  background: transparent;
  color: var(--md-sys-color-primary);
}

.btn-cancel:hover {
  background: var(--md-sys-state-hover);
}

.btn-delete {
  border: none;
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.btn-delete:hover {
  box-shadow: var(--md-sys-elevation-1);
}

/* Transitions */
.note-modal-fade-enter-active,
.note-modal-fade-leave-active {
  transition: opacity var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-modal-fade-enter-active .note-modal-card,
.note-modal-fade-leave-active .note-modal-card {
  transition: transform var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-modal-fade-enter-from,
.note-modal-fade-leave-to {
  opacity: 0;
}

.note-modal-fade-enter-from .note-modal-card,
.note-modal-fade-leave-to .note-modal-card {
  transform: scale(0.96) translateY(8px);
}

/* Responsive */
@media (max-width: 600px) {
  .note-modal-card {
    width: 98vw;
    max-height: 94vh;
    border-radius: var(--md-sys-shape-corner-xl);
  }

  .modal-header,
  .modal-footer {
    padding: 0.75rem 1rem;
  }

  .modal-body {
    padding: 1rem;
  }
}
</style>
