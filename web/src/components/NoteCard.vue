<template>
  <article
    class="note-card"
    :class="{
      'is-sticky': thing.sticky,
      'is-archived': thing.archived,
      'is-editing': isEditing,
      'is-selected': selected,
      'is-clickable': !isEditing && hasOpenDetailListener
    }"
    :style="{ backgroundColor: 'var(--note-color-' + (thing.color || 'default') + ')' }"
    @click="handleCardClick"
  >
    <!-- Selection Checkbox Button -->
    <button
      v-if="canEdit && !isEditing"
      type="button"
      class="card-select-btn"
      :class="{ 'is-selected': selected, 'is-visible': selectable || selected }"
      :title="selected ? 'Deselect note' : 'Select note'"
      :aria-label="selected ? 'Deselect note' : 'Select note'"
      :aria-pressed="selected"
      @click.stop="$emit('toggleSelect', thing)"
    >
      <span class="select-check-icon">{{ selected ? '✓' : '' }}</span>
    </button>

    <!-- Card Header / Meta & Action Buttons -->
    <header class="card-header">
      <div class="header-meta">
        <time :datetime="isoDate" :title="fullDate" class="note-time">
          {{ relativeDate }}
        </time>
        <span v-if="thing.sticky" class="badge badge-sticky" title="Pinned to top">
          <UiIcon name="pin" /> Pinned
        </span>
        <span v-if="thing.public" class="badge badge-public" title="Visible on public stream">
          <UiIcon name="globe" /> Public
        </span>
        <span v-if="thing.shared" class="badge badge-shared" title="Directly shared">
          <UiIcon name="attach" /> Shared
        </span>
        <span v-if="thing.archived" class="badge badge-archived" title="Archived note">
          <UiIcon name="archive" /> Archived
        </span>
      </div>

      <button
        v-if="onRestore && !isEditing"
        type="button"
        class="action-btn"
        title="Restore note"
        aria-label="Restore note"
        @click.stop="onRestore(thing)"
      >
        <UiIcon name="restore" />
      </button>

      <button
        v-if="!isEditing && !selectable && hasOpenDetailListener"
        type="button"
        class="action-btn open-note-btn"
        title="Open note"
        aria-label="Open note"
        @click.stop="$emit('openDetail', thing, 'view')"
      >
        <UiIcon name="expand" />
      </button>
    </header>

    <div v-if="actionError" class="action-error" role="alert">
      {{ actionError }}
    </div>

    <!-- Normal View: Markdown Content -->
    <template v-if="!isEditing">
      <div ref="cardBodyRef" class="card-body markdown-body" v-html="renderedBody" @click="handleBodyClick"></div>

      <!-- Attachments Display -->
      <div v-if="thing.attachments && thing.attachments.length > 0" class="card-attachments">
        <div
          v-for="att in thing.attachments"
          :key="att.identifier"
          class="attachment-item"
        >
          <a
            :href="attachmentUrl(att)"
            target="_blank"
            rel="noopener"
            class="attachment-link"
            @click="handleAttachmentClick($event, att)"
          >
            <span class="attachment-icon">{{ isImageAttachment(att) ? '🖼️' : '📎' }}</span>
            <span class="attachment-name">{{ att.fileName || att.identifier }}</span>
            <span v-if="att.size" class="attachment-size">({{ formatFileSize(att.size) }})</span>
          </a>
        </div>
      </div>

      <!-- Tags Footer -->
      <footer v-if="thing.tags && thing.tags.length > 0" class="card-footer">
        <div class="tags-container">
          <button
            v-for="tag in thing.tags"
            :key="tag"
            type="button"
            class="tag-pill"
            @click="$emit('tagClick', tag)"
            :title="`Filter by #${tag}`"
          >
            #{{ tag }}
          </button>
        </div>
      </footer>

      <!-- Action Buttons (when editable and not in edit mode) -->
      <div v-if="canEdit && !isEditing" class="card-actions" role="group" aria-label="Note actions" @click.stop>
        <!-- Color Picker Popover -->
        <div ref="colorPickerWrapperRef" class="color-picker-wrapper">
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
            <UiIcon name="palette" />
          </button>
          <div
            v-if="showColorPicker"
            ref="colorPaletteRef"
            class="color-palette-popover"
            role="group"
            aria-label="Note card color"
          >
            <button
              v-for="(c, index) in NOTE_COLORS"
              :key="c.key"
              type="button"
              class="color-swatch-btn"
              :class="{ active: (thing.color || 'default') === c.key }"
              :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
              :title="c.name"
              :aria-label="c.name"
              :aria-pressed="(thing.color || 'default') === c.key"
              :aria-disabled="isColorSaving"
              :tabindex="focusedColorIndex === index ? 0 : -1"
              @click="selectColor(c.key)"
              @keydown="handleColorKeydown($event, index)"
            ></button>
          </div>
        </div>

        <!-- Sticky Toggle -->
        <button
          type="button"
          class="action-btn"
          :class="{ active: thing.sticky }"
          :title="thing.sticky ? 'Remove pin' : 'Pin to top'"
          :aria-label="thing.sticky ? 'Remove pin' : 'Pin to top'"
          :aria-pressed="!!thing.sticky"
          @click="$emit('toggleSticky', thing)"
        >
          <UiIcon name="pin" />
        </button>

        <!-- Public Toggle -->
        <button
          type="button"
          class="action-btn"
          :class="{ active: thing.public }"
          :title="thing.public ? 'Make private' : 'Make public'"
          :aria-label="thing.public ? 'Make private' : 'Make public'"
          :aria-pressed="!!thing.public"
          @click="$emit('togglePublic', thing)"
        >
          <UiIcon name="globe" />
        </button>

        <!-- Archive / Restore Toggle -->
        <button
          type="button"
          class="action-btn"
          :class="{ active: thing.archived }"
          :title="thing.archived ? 'Restore note' : 'Archive note'"
          :aria-label="thing.archived ? 'Restore note' : 'Archive note'"
          @click="$emit('toggleArchive', thing)"
        >
          <UiIcon :name="thing.archived ? 'restore' : 'archive'" />
        </button>

        <!-- Edit Button -->
        <button
          type="button"
          class="action-btn"
          title="Edit note"
          aria-label="Edit note"
          @click="startEdit"
        >
          <UiIcon name="edit" />
        </button>

        <!-- Delete Button -->
        <button
          ref="deleteTriggerRef"
          type="button"
          class="action-btn delete-btn"
          title="Delete note"
          aria-label="Delete note"
          @click="openDeleteConfirm"
        >
          <UiIcon name="trash" />
        </button>
      </div>
    </template>

    <!-- Inline Edit Form -->
    <template v-else>
      <div class="inline-edit-form">
        <textarea
          ref="editTextareaRef"
          v-model="editContent"
          class="edit-textarea"
          aria-label="Edit note content"
          rows="5"
          @keydown="handleEditKeyDown"
          @input="editGeneration++"
        ></textarea>

        <div v-if="editError" class="edit-error" role="alert">
          {{ editError }}
        </div>

        <div class="edit-actions">
          <div class="edit-hint">
            <kbd>Ctrl+S</kbd> or <kbd>Ctrl+Enter</kbd> to save, <kbd>Esc</kbd> to cancel
          </div>
          <div class="edit-btn-group">
            <button
              type="button"
              class="btn-edit secondary"
              :disabled="isSaving"
              @click="cancelEdit"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-edit primary"
              :disabled="isSaving || !editContent.trim()"
              @click="saveEdit"
            >
              <span v-if="isSaving">Saving...</span>
              <span v-else>Save</span>
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- Delete Confirmation Modal -->
    <div
      v-if="showDeleteConfirm"
      class="delete-modal-overlay"
      @click.self="closeDeleteConfirm(true)"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-confirm-title"
    >
      <div ref="deleteModalCardRef" class="delete-modal-card">
        <h3 id="delete-confirm-title">Move note to trash?</h3>
        <p>This note can be restored from Trash.</p>
        <div class="delete-modal-actions">
          <button
            ref="cancelDeleteBtnRef"
            type="button"
            class="btn-modal cancel"
            :disabled="isDeleting"
            @click="closeDeleteConfirm(true)"
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn-modal confirm-delete"
            :disabled="isDeleting"
            @click="confirmDelete"
          >
            <span v-if="isDeleting">Deleting...</span>
            <span v-else>Move to Trash</span>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import UiIcon from './UiIcon.vue';
import type { Thing, AttachmentDescriptor, NoteColor } from '../api/client';
import { NOTE_COLORS } from '../constants/noteColors';
import { renderMarkdown, highlightKeyword, toggleTaskItem } from '../utils/markdown';
import type { LightboxImage } from './ImageLightbox.vue';

const showColorPicker = ref(false);
const isColorSaving = ref(false);
const actionError = ref<string | null>(null);
const focusedColorIndex = ref(0);
const colorPickerWrapperRef = ref<HTMLElement | null>(null);
const colorTriggerRef = ref<HTMLButtonElement | null>(null);
const colorPaletteRef = ref<HTMLElement | null>(null);

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
  const selected = NOTE_COLORS.findIndex((color) => color.key === (props.thing.color || 'default'));
  focusColor(selected < 0 ? 0 : selected);
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

function handleOutsideColorPicker(event: PointerEvent) {
  if (showColorPicker.value && !colorPickerWrapperRef.value?.contains(event.target as Node)) {
    closeColorPicker();
  }
}

async function selectColor(color: NoteColor, closeAfterSave = true) {
  if (isColorSaving.value) return;
  if (color === (props.thing.color || 'default')) {
    if (closeAfterSave) closeColorPicker(true);
    return;
  }
  actionError.value = null;
  if (!props.onSaveEdit) {
    emit('update', props.thing._id, { color });
    if (closeAfterSave) closeColorPicker(true);
    return;
  }

  isColorSaving.value = true;
  try {
    const result = await props.onSaveEdit(props.thing._id, { color });
    if (result.success && closeAfterSave) closeColorPicker(true);
    else if (!result.success) actionError.value = result.error || 'Failed to update note color';
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Failed to update note color';
  } finally {
    isColorSaving.value = false;
  }
}

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleOutsideColorPicker);
  document.removeEventListener('keydown', handleDeleteModalKeydown);
});

const props = withDefaults(
  defineProps<{
    thing: Thing;
    canEdit?: boolean;
    selectable?: boolean;
    selected?: boolean;
    highlightQuery?: string;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; error?: string }>;
    onDeleteConfirm?: (id: string) => Promise<{ success: boolean; error?: string }>;
    onRestore?: (thing: Thing) => void | Promise<void>;
  }>(),
  {
    canEdit: true,
    selectable: false,
    selected: false,
    highlightQuery: '',
  }
);

const emit = defineEmits<{
  (e: 'tagClick', tag: string): void;
  (e: 'wikilinkClick', target: string): void;
  (e: 'toggleSticky', thing: Thing): void;
  (e: 'togglePublic', thing: Thing): void;
  (e: 'toggleArchive', thing: Thing): void;
  (e: 'toggleSelect', thing: Thing): void;
  (e: 'imageClick', images: LightboxImage[], initialIndex: number): void;
  (e: 'update', id: string, updates: Partial<Thing>): void;
  (e: 'delete', id: string): void;
  (e: 'openDetail', thing: Thing, mode: 'view' | 'edit'): void;
}>();

const isEditing = ref(false);
const editContent = ref('');
const isSaving = ref(false);
const editError = ref<string | null>(null);
let editGeneration = 0;
const editTextareaRef = ref<HTMLTextAreaElement | null>(null);

const showDeleteConfirm = ref(false);
const isDeleting = ref(false);
const deleteTriggerRef = ref<HTMLButtonElement | null>(null);
const deleteModalCardRef = ref<HTMLDivElement | null>(null);
const cancelDeleteBtnRef = ref<HTMLButtonElement | null>(null);

function openDeleteConfirm() {
  showDeleteConfirm.value = true;
  document.addEventListener('keydown', handleDeleteModalKeydown);
  nextTick(() => {
    cancelDeleteBtnRef.value?.focus();
  });
}

function closeDeleteConfirm(returnFocus = true) {
  showDeleteConfirm.value = false;
  document.removeEventListener('keydown', handleDeleteModalKeydown);
  if (returnFocus) {
    nextTick(() => {
      deleteTriggerRef.value?.focus();
    });
  }
}

function handleDeleteModalKeydown(event: KeyboardEvent) {
  if (!showDeleteConfirm.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeDeleteConfirm(true);
    return;
  }
  if (event.key === 'Tab' && deleteModalCardRef.value) {
    const focusable = deleteModalCardRef.value.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

const dateValue = computed(() => {
  return props.thing.modifiedAt || props.thing.createdAt || Date.now();
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

const renderedMarkdown = computed(() => renderMarkdown(props.thing.richContent || props.thing.content || ''));
const renderedBody = computed(() => {
  const html = renderedMarkdown.value;
  return props.highlightQuery ? highlightKeyword(html, props.highlightQuery) : html;
});

function isImageAttachment(att: AttachmentDescriptor): boolean {
  if (att.type === 'image') return true;
  if (att.mime?.startsWith('image/')) return true;
  const name = att.fileName?.toLowerCase() || '';
  return /\.(png|jpe?g|gif|webp|svg)$/.test(name);
}

function attachmentUrl(att: AttachmentDescriptor): string {
  return `/api/files/${props.thing.ownerId || 'me'}/${props.thing._id}/${att.identifier}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const instance = getCurrentInstance();
const hasOpenDetailListener = computed(() => Boolean(instance?.vnode.props?.onOpenDetail));

function startEdit() {
  if (hasOpenDetailListener.value) {
    emit('openDetail', props.thing, 'edit');
    return;
  }
  editContent.value = props.thing.content || '';
  editGeneration = 0;
  editError.value = null;
  isEditing.value = true;
  nextTick(() => {
    editTextareaRef.value?.focus();
  });
}

function cancelEdit() {
  isEditing.value = false;
  editError.value = null;
}

function handleCardClick(event: MouseEvent) {
  if (isEditing.value || !hasOpenDetailListener.value) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;

  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (
    target.closest('.card-select-btn') ||
    target.closest('.card-actions') ||
    target.closest('.task-list-item-checkbox') ||
    target.closest('.attachment-link') ||
    target.closest('.tag-pill') ||
    target.closest('a') ||
    target.closest('.delete-modal-overlay') ||
    target.closest('.inline-edit-form')
  ) {
    return;
  }

  if (target.closest('img') && hasImageClickListener.value) {
    return;
  }

  emit('openDetail', props.thing, 'view');
}

const cardBodyRef = ref<HTMLElement | null>(null);

function collectImages(): LightboxImage[] {
  const images: LightboxImage[] = [];
  if (cardBodyRef.value) {
    const imgs = cardBodyRef.value.querySelectorAll<HTMLImageElement>('img');
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
  if (props.thing.attachments && props.thing.attachments.length > 0) {
    for (const att of props.thing.attachments) {
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

function openLightbox(src: string) {
  const images = collectImages();
  if (images.length === 0) return;
  const index = images.findIndex((img) => img.src === src);
  emit('imageClick', images, index >= 0 ? index : 0);
}

const hasImageClickListener = computed(() => Boolean(instance?.vnode.props?.onImageClick));
const isTaskSaving = ref(false);

function handleAttachmentClick(event: MouseEvent, att: AttachmentDescriptor) {
  if (hasImageClickListener.value && isImageAttachment(att) && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
    event.preventDefault();
    openLightbox(attachmentUrl(att));
  }
}

async function handleBodyClick(event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;

  const targetEl = event.target as HTMLElement | null;
  if (!targetEl) return;

  // 1. Task list item checkbox click (interactive checklist)
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

    const currentContent = props.thing.content || '';
    const updatedContent = toggleTaskItem(currentContent, taskIndex);
    if (updatedContent === currentContent) return;

    const wasChecked = !checkbox.checked;
    isTaskSaving.value = true;
    actionError.value = null;

    try {
      if (props.onSaveEdit) {
        const result = await props.onSaveEdit(props.thing._id, { content: updatedContent });
        if (!result.success) {
          checkbox.checked = wasChecked;
          actionError.value = result.error || 'Failed to update task';
        }
      } else {
        emit('update', props.thing._id, { content: updatedContent });
      }
    } catch (err: any) {
      checkbox.checked = wasChecked;
      actionError.value = err.message || 'Failed to update task';
    } finally {
      isTaskSaving.value = false;
    }
    return;
  }

  // 2. Image click inside markdown body (lightbox preview)
  const imgTarget = targetEl.closest('img');
  if (imgTarget && hasImageClickListener.value) {
    const anchor = imgTarget.closest('a');
    if (!anchor) {
      event.preventDefault();
      event.stopPropagation();
      openLightbox(imgTarget.getAttribute('src') || '');
      return;
    }
  }

  // 3. Anchor links (wikilinks or tag searches)
  const target = targetEl.closest('a');
  if (!target) return;

  if (target.classList.contains('wikilink') || target.dataset.wikilink) {
    event.preventDefault();
    const query = target.dataset.wikilink || target.textContent?.trim() || '';
    if (query) {
      emit('wikilinkClick', query);
    }
    return;
  }

  const href = target.getAttribute('href') || '';
  if (href.startsWith('#search?#')) {
    event.preventDefault();
    const tag = href.replace('#search?#', '').trim();
    if (tag) {
      emit('tagClick', tag);
    }
  }
}

function handleEditKeyDown(e: KeyboardEvent) {
  if (((e.ctrlKey || e.metaKey) && e.key === 'Enter') || ((e.ctrlKey || e.metaKey) && e.key === 's')) {
    e.preventDefault();
    saveEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelEdit();
  }
}

async function saveEdit() {
  const trimmed = editContent.value.trim();
  if (!trimmed || isSaving.value) return;

  isSaving.value = true;
  editError.value = null;
  const saveGeneration = editGeneration;

  if (props.onSaveEdit) {
    const result = await props.onSaveEdit(props.thing._id, { content: trimmed });
    if (result.success) {
      if (saveGeneration === editGeneration) isEditing.value = false;
    } else {
      editError.value = result.error || 'Failed to save note';
    }
  } else {
    emit('update', props.thing._id, { content: trimmed });
    isEditing.value = false;
  }
  isSaving.value = false;
}

async function confirmDelete() {
  if (isDeleting.value) return;
  isDeleting.value = true;

  if (props.onDeleteConfirm) {
    const result = await props.onDeleteConfirm(props.thing._id);
    if (result.success) {
      closeDeleteConfirm(false);
    }
  } else {
    emit('delete', props.thing._id);
    closeDeleteConfirm(false);
  }
  isDeleting.value = false;
}
</script>

<style scoped>
.note-card {
  background-color: var(--note-color-default);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--note-border-color);
  border-radius: var(--md-sys-shape-corner-lg);
  padding: 1rem;
  box-shadow: var(--md-sys-elevation-1);
  transition: box-shadow var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              border-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
  position: relative;
}

.note-card:hover {
  box-shadow: var(--md-sys-elevation-2);
  border-color: var(--note-border-hover);
}

.note-card.is-clickable {
  cursor: pointer;
}

.note-card.is-sticky {
  box-shadow: var(--md-sys-elevation-2);
  border-color: color-mix(in srgb, var(--md-sys-color-primary) 45%, transparent);
}

.note-card.is-sticky:hover {
  box-shadow: var(--md-sys-elevation-3);
}

.note-card.is-archived {
  opacity: 0.85;
}

.note-card.is-editing {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 0 0 2px var(--md-sys-color-primary-container);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 0.75rem;
  gap: 0.5rem;
}

.header-meta {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.note-time {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: var(--md-sys-typescale-label-small);
  font-weight: 500;
  padding: 0.12rem 0.5rem;
  border-radius: var(--md-sys-shape-corner-sm);
  line-height: 1.3;
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

.badge .ui-icon {
  width: 0.75rem;
  height: 0.75rem;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin: 0.75rem -0.5rem -0.5rem;
}

.action-btn {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  color: var(--md-sys-color-on-surface-variant);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.action-btn:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.action-btn:hover {
  background-color: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}

.action-btn:active {
  background-color: var(--md-sys-state-pressed);
}

.action-btn.active {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

.action-btn.delete-btn:hover {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}

.color-picker-wrapper {
  position: relative;
  display: inline-flex;
}

.color-palette-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 8px;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-lg);
  box-shadow: var(--md-sys-elevation-2);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(4, 40px);
  gap: 4px;
  z-index: 50;
}

.color-swatch-btn {
  width: 40px;
  height: 40px;
  border-radius: var(--md-sys-shape-corner-full);
  /* 40px touch target around a 28px swatch */
  border: 6px solid transparent;
  background-clip: content-box;
  cursor: pointer;
  padding: 0;
  box-shadow: inset 0 0 0 1px var(--md-sys-color-outline-variant);
  transition: transform var(--md-sys-motion-duration-short) var(--md-sys-motion-easing);
}

.color-swatch-btn:hover {
  transform: scale(1.1);
}

/* Selection ring sits in the transparent border, 2px off the swatch */
.color-swatch-btn.active {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: -4px;
}

.color-swatch-btn:focus-visible {
  outline: 2px solid var(--md-sys-color-on-surface);
  outline-offset: -2px;
}

.color-swatch-btn[aria-disabled="true"] {
  cursor: wait;
}

.action-error {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  border-radius: var(--md-sys-shape-corner-sm);
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.75rem;
  font-size: var(--md-sys-typescale-body-medium);
}

.card-body {
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface);
  word-break: break-word;
  overflow-wrap: break-word;
}

.card-body :deep(h1),
.card-body :deep(h2),
.card-body :deep(h3),
.card-body :deep(h4),
.card-body :deep(h5),
.card-body :deep(h6) {
  font-size: 1.125rem;
  line-height: 1.4;
  font-weight: 600;
}

.card-body :deep(h1) {
  font-size: 1.25rem;
}

.card-body :deep(h3),
.card-body :deep(h4),
.card-body :deep(h5),
.card-body :deep(h6) {
  font-size: 1rem;
}

.card-body :deep(> * + *) {
  margin-top: 0.625rem;
}

.card-body :deep(ul),
.card-body :deep(ol) {
  padding-left: 1.25rem;
}

.card-body :deep(blockquote) {
  padding-left: 0.75rem;
  border-left: 2px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
}

.card-body :deep(mark) {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0 2px;
}

.card-body :deep(.wikilink) {
  display: inline;
  color: var(--md-sys-color-primary);
  background-color: var(--md-sys-color-primary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 1px 6px;
  font-size: 0.9em;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.card-body :deep(.wikilink):hover {
  text-decoration: underline;
}

.card-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: var(--md-sys-shape-corner-md);
  display: block;
  margin: 0.75rem 0;
}

.card-body :deep(picture),
.card-body :deep(video) {
  max-width: 100%;
  height: auto;
  border-radius: var(--md-sys-shape-corner-md);
  display: block;
  margin: 0.75rem 0;
}

.card-body :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-md);
  padding: 0.75rem 1rem;
  margin: 0.75rem 0;
}

.card-body :deep(table) {
  max-width: 100%;
  overflow-x: auto;
  display: block;
}

.card-attachments {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.attachment-link {
  min-width: 0;
  overflow-wrap: anywhere;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-primary);
  text-decoration: none;
}

.attachment-link:hover {
  text-decoration: underline;
}

.attachment-size {
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.75rem;
}

.card-footer {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-pill {
  min-height: 32px;
  max-width: 100%;
  overflow-wrap: anywhere;
  background-color: var(--md-sys-color-surface-container-high);
  border: 1px solid transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-medium);
  font-weight: 500;
  padding: 0.15rem 0.625rem;
  border-radius: var(--md-sys-shape-corner-sm);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.tag-pill:hover {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}

/* Inline Edit Styles */
.inline-edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  border: 1px solid var(--md-sys-color-outline);
  border-radius: var(--md-sys-shape-corner-sm);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.5;
  color: var(--md-sys-color-on-surface);
  background: transparent;
  resize: vertical;
  outline: none;
}

.edit-textarea:focus {
  border-color: var(--md-sys-color-primary);
  box-shadow: inset 0 0 0 1px var(--md-sys-color-primary);
}

.edit-error {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  border-radius: var(--md-sys-shape-corner-sm);
  padding: 0.5rem 0.75rem;
  font-size: var(--md-sys-typescale-body-medium);
}

.edit-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
}

.edit-hint {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.edit-hint kbd {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0.1rem 0.3rem;
  font-size: var(--md-sys-typescale-label-small);
  font-family: var(--md-sys-typescale-font-mono);
}

.edit-btn-group {
  display: flex;
  gap: 0.5rem;
}

.btn-edit {
  min-height: 36px;
  padding: 0.35rem 1rem;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.btn-edit.primary {
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border: 1px solid transparent;
}

.btn-edit.primary:hover:not(:disabled) {
  box-shadow: var(--md-sys-elevation-1);
}

.btn-edit.secondary {
  background-color: transparent;
  color: var(--md-sys-color-primary);
  border: 1px solid var(--md-sys-color-outline);
}

.btn-edit.secondary:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}

/* Delete Modal */
.delete-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: var(--md-sys-color-scrim);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
}

.delete-modal-card {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  border-radius: var(--md-sys-shape-corner-2xl);
  padding: 1.75rem;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--md-sys-elevation-3);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.delete-modal-card h3 {
  font-size: var(--md-sys-typescale-headline-small);
  font-weight: 400;
  color: var(--md-sys-color-on-surface);
  margin-bottom: 0.75rem;
}

.delete-modal-card p {
  font-size: var(--md-sys-typescale-body-medium);
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.delete-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-modal {
  min-height: 40px;
  padding: 0.5rem 1.25rem;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              box-shadow var(--md-sys-motion-duration-short) ease;
}

.btn-modal:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.btn-modal.cancel {
  background-color: transparent;
  color: var(--md-sys-color-primary);
}

.btn-modal.cancel:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}

.btn-modal.confirm-delete {
  background-color: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}

.btn-modal.confirm-delete:hover:not(:disabled) {
  box-shadow: var(--md-sys-elevation-1);
}

/* Card Selection Checkbox */
.card-select-btn {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 28px;
  height: 28px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 2px solid var(--md-sys-color-outline);
  background-color: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity var(--md-sys-motion-duration-short) ease,
              transform var(--md-sys-motion-duration-short) var(--md-sys-motion-easing),
              background-color var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
  z-index: 5;
  box-shadow: var(--md-sys-elevation-1);
  padding: 0;
}

/* Expand touch target to min 44x44px without visual crowding */
.card-select-btn::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 44px;
  min-height: 44px;
  width: 100%;
  height: 100%;
}

.note-card:hover .card-select-btn,
.card-select-btn.is-visible,
.card-select-btn:focus-visible {
  opacity: 1;
  transform: scale(1);
}

.card-select-btn.is-selected {
  opacity: 1;
  transform: scale(1);
  background-color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}

.note-card.is-selected {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 1px;
}

.select-check-icon {
  font-size: 13px;
  font-weight: bold;
  line-height: 1;
}

/* Task List Interactive Checkbox Styles */
:deep(.task-list) {
  list-style: none;
  padding-left: 0.25rem;
  margin: 0.5rem 0;
}

:deep(.task-list-item) {
  display: flex;
  align-items: flex-start;
  margin-bottom: 0.35rem;
  line-height: 1.5;
}

:deep(.task-list-item.is-completed) {
  text-decoration: line-through;
  opacity: 0.65;
}

:deep(.task-list-item-checkbox) {
  appearance: auto;
  width: 1.1rem;
  height: 1.1rem;
  margin-right: 0.55rem;
  margin-top: 0.2rem;
  cursor: pointer;
  accent-color: var(--md-sys-color-primary);
  flex-shrink: 0;
}

/* Markdown Image Lightbox Cursor */
:deep(.markdown-body img) {
  cursor: zoom-in;
  border-radius: var(--md-sys-shape-corner-md);
  max-width: 100%;
  transition: transform var(--md-sys-motion-duration-short) var(--md-sys-motion-easing);
}

:deep(.markdown-body img:hover) {
  transform: scale(1.01);
}

@media (hover: none) {
  .card-select-btn {
    opacity: 0.85;
    transform: scale(1);
  }
}
</style>
