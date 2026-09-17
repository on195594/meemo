<template>
  <article
    class="note-card"
    :class="{
      'is-sticky': thing.sticky,
      'is-archived': thing.archived,
      'is-editing': isEditing,
      'is-selected': selected
    }"
    :style="{ backgroundColor: 'var(--note-color-' + (thing.color || 'default') + ')' }"
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
          📌 Pinned
        </span>
        <span v-if="thing.public" class="badge badge-public" title="Visible on public stream">
          🌐 Public
        </span>
        <span v-if="thing.shared" class="badge badge-shared" title="Directly shared">
          🔗 Shared
        </span>
        <span v-if="thing.archived" class="badge badge-archived" title="Archived note">
          📦 Archived
        </span>
      </div>

      <!-- Action Buttons (when editable and not in edit mode) -->
      <div v-if="canEdit && !isEditing" class="card-actions">
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
            🎨
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
          @click="$emit('toggleSticky', thing)"
        >
          📌
        </button>

        <!-- Public Toggle -->
        <button
          type="button"
          class="action-btn"
          :class="{ active: thing.public }"
          :title="thing.public ? 'Make private' : 'Make public'"
          @click="$emit('togglePublic', thing)"
        >
          🌐
        </button>

        <!-- Archive / Restore Toggle -->
        <button
          type="button"
          class="action-btn"
          :class="{ active: thing.archived }"
          :title="thing.archived ? 'Restore note' : 'Archive note'"
          @click="$emit('toggleArchive', thing)"
        >
          {{ thing.archived ? '↩️' : '📦' }}
        </button>

        <!-- Edit Button -->
        <button
          type="button"
          class="action-btn"
          title="Edit note"
          @click="startEdit"
        >
          ✏️
        </button>

        <!-- Delete Button -->
        <button
          type="button"
          class="action-btn delete-btn"
          title="Delete note"
          @click="showDeleteConfirm = true"
        >
          🗑️
        </button>
      </div>
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
    </template>

    <!-- Inline Edit Form -->
    <template v-else>
      <div class="inline-edit-form">
        <textarea
          ref="editTextareaRef"
          v-model="editContent"
          class="edit-textarea"
          rows="5"
          :disabled="isSaving"
          @keydown="handleEditKeyDown"
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
      @click.self="showDeleteConfirm = false"
      role="dialog"
      aria-modal="true"
    >
      <div class="delete-modal-card">
        <h3>Delete Note?</h3>
        <p>Are you sure you want to permanently delete this note? This action cannot be undone.</p>
        <div class="delete-modal-actions">
          <button
            type="button"
            class="btn-modal cancel"
            :disabled="isDeleting"
            @click="showDeleteConfirm = false"
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
            <span v-else>Delete Permanently</span>
          </button>
        </div>
      </div>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted, getCurrentInstance } from 'vue';
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

onUnmounted(() => document.removeEventListener('pointerdown', handleOutsideColorPicker));

const props = withDefaults(
  defineProps<{
    thing: Thing;
    canEdit?: boolean;
    selectable?: boolean;
    selected?: boolean;
    highlightQuery?: string;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; error?: string }>;
    onDeleteConfirm?: (id: string) => Promise<{ success: boolean; error?: string }>;
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
}>();

const isEditing = ref(false);
const editContent = ref('');
const isSaving = ref(false);
const editError = ref<string | null>(null);
const editTextareaRef = ref<HTMLTextAreaElement | null>(null);

const showDeleteConfirm = ref(false);
const isDeleting = ref(false);

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

const renderedBody = computed(() => {
  const raw = props.thing.richContent || props.thing.content || '';
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
  return `/api/files/${props.thing.ownerId || 'me'}/${props.thing._id}/${att.identifier}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function startEdit() {
  editContent.value = props.thing.content || '';
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

const instance = getCurrentInstance();
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

  if (props.onSaveEdit) {
    const result = await props.onSaveEdit(props.thing._id, { content: trimmed });
    if (result.success) {
      isEditing.value = false;
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
      showDeleteConfirm.value = false;
    }
  } else {
    emit('delete', props.thing._id);
    showDeleteConfirm.value = false;
  }
  isDeleting.value = false;
}
</script>

<style scoped>
.note-card {
  background-color: var(--note-color-default);
  border: 1px solid var(--note-border-color);
  border-radius: var(--md-sys-shape-corner-lg, 16px);
  padding: 1.25rem 1.4rem;
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

.note-card.is-sticky {
  border-left: 4px solid var(--md-sys-color-primary);
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
  align-items: center;
  margin-bottom: 0.75rem;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.note-time {
  font-size: 0.825rem;
  color: var(--md-sys-color-on-surface-variant);
}

.badge {
  font-size: 0.725rem;
  font-weight: 500;
  padding: 0.12rem 0.45rem;
  border-radius: 10px;
  line-height: 1.3;
}

.badge-sticky,
.badge-shared {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.badge-public {
  background-color: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.badge-archived {
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  opacity: 0;
  transition: opacity var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-card:hover .card-actions,
.note-card:focus-within .card-actions {
  opacity: 1;
}

@media (hover: none) {
  .card-actions {
    opacity: 0.85;
  }
}

.action-btn {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0.35rem 0.45rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all var(--md-sys-motion-duration-short) ease;
}

/* Expand touch target to min 48x48px on pointer/touch */
.action-btn::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  min-width: 48px;
  min-height: 48px;
  width: 100%;
  height: 100%;
}

.action-btn:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.action-btn:hover {
  background-color: var(--md-sys-color-surface-container-high);
}

.action-btn.active {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.action-btn.delete-btn:hover {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
}

.color-picker-wrapper {
  position: relative;
  display: inline-flex;
}

.color-palette-popover {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 8px;
  background: var(--md-sys-color-surface-container, #ffffff);
  border: 1px solid var(--md-sys-color-outline-variant, #c4c7c5);
  border-radius: var(--md-sys-shape-corner-md, 12px);
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
  border-radius: 50%;
  border: 8px solid transparent;
  background-clip: content-box;
  cursor: pointer;
  padding: 0;
  box-shadow: inset 0 0 0 1px var(--note-border-color);
  transition: transform var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

.color-swatch-btn:hover,
.color-swatch-btn:focus-visible {
  transform: scale(1.15);
  outline: 2px solid var(--md-sys-color-primary);
}

.color-swatch-btn.active {
  box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
}

.color-swatch-btn[aria-disabled="true"] {
  cursor: wait;
}

.action-error {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
  border: 1px solid var(--md-sys-color-error);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0.4rem 0.6rem;
  margin-bottom: 0.75rem;
  font-size: 0.85rem;
}

.card-body {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface, #1f1f1f);
  word-break: break-word;
  overflow-wrap: break-word;
}

.card-body :deep(mark) {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-radius: 2px;
  padding: 0 2px;
}

.card-body :deep(.wikilink) {
  display: inline;
  color: var(--md-sys-color-primary);
  background-color: var(--md-sys-color-primary-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 0.9em;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.card-body :deep(.wikilink):hover {
  opacity: 0.85;
  text-decoration: underline;
}

.card-body :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  margin: 0.75rem 0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.card-body :deep(picture),
.card-body :deep(video) {
  max-width: 100%;
  height: auto;
  border-radius: 6px;
  display: block;
  margin: 0.75rem 0;
}

.card-body :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  background-color: var(--md-sys-color-surface-container-high, #e9eef6);
  color: var(--md-sys-color-on-surface, #1f1f1f);
  border: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
  border-radius: var(--md-sys-shape-corner-md, 12px);
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
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
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
  background-color: var(--md-sys-color-surface-container-high);
  border: 1px solid transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.tag-pill:hover {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-color: var(--md-sys-color-outline-variant);
}

/* Inline Edit Styles */
.inline-edit-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.edit-textarea {
  width: 100%;
  padding: 0.6rem;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  color: var(--md-sys-color-on-surface);
  background: transparent;
  resize: vertical;
  outline: none;
}

.edit-textarea:focus {
  border-color: var(--md-sys-color-primary);
}

.edit-error {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
  border: 1px solid var(--md-sys-color-error);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
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
  font-size: 0.75rem;
  color: var(--md-sys-color-on-surface-variant);
}

.edit-hint kbd {
  background: var(--md-sys-color-surface-container-high);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 3px;
  padding: 0.1rem 0.3rem;
  font-size: 0.7rem;
  font-family: monospace;
}

.edit-btn-group {
  display: flex;
  gap: 0.5rem;
}

.btn-edit {
  padding: 0.35rem 0.8rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.btn-edit.primary {
  background-color: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  border: 1px solid transparent;
}

.btn-edit.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-edit.secondary {
  background-color: transparent;
  color: var(--md-sys-color-on-surface-variant);
  border: 1px solid var(--md-sys-color-outline-variant);
}

.btn-edit.secondary:hover:not(:disabled) {
  background-color: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}

/* Delete Modal */
.delete-modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.4);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
}

.delete-modal-card {
  background: var(--md-sys-color-surface-container-high, #ffffff);
  border-radius: var(--md-sys-shape-corner-2xl, 28px);
  padding: 1.75rem;
  max-width: 420px;
  width: 90%;
  box-shadow: var(--md-sys-elevation-3);
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.1));
}

.delete-modal-card h3 {
  font-size: 1.25rem;
  color: var(--md-sys-color-error, #e53e3e);
  margin-bottom: 0.75rem;
}

.delete-modal-card p {
  font-size: 0.95rem;
  color: var(--md-sys-color-on-surface-variant, #4a5568);
  line-height: 1.5;
  margin-bottom: 1.5rem;
}

.delete-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-modal {
  padding: 0.5rem 1.1rem;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all var(--md-sys-motion-duration-short) ease;
}

.btn-modal:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.btn-modal.cancel {
  background-color: transparent;
  color: var(--md-sys-color-primary, #0b57d0);
}

.btn-modal.cancel:hover:not(:disabled) {
  background-color: var(--md-sys-color-surface-container-high);
}

.btn-modal.confirm-delete {
  background-color: var(--md-sys-color-error, #ba1a1a);
  color: var(--md-sys-color-on-error, #ffffff);
}

.btn-modal.confirm-delete:hover:not(:disabled) {
  opacity: 0.9;
}

/* Card Selection Checkbox */
.card-select-btn {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid var(--md-sys-color-outline, #79747e);
  background-color: var(--md-sys-color-surface, #fff);
  color: var(--md-sys-color-on-primary, #fff);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transform: scale(0.85);
  transition: opacity 0.15s ease, transform 0.15s ease, background-color 0.15s ease, border-color 0.15s ease;
  z-index: 5;
  box-shadow: var(--md-sys-elevation-1, 0 1px 3px rgba(0, 0, 0, 0.2));
  padding: 0;
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
  background-color: var(--md-sys-color-primary, #6750a4);
  border-color: var(--md-sys-color-primary, #6750a4);
}

.note-card.is-selected {
  outline: 2px solid var(--md-sys-color-primary, #6750a4);
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
  accent-color: var(--md-sys-color-primary, #6750a4);
  flex-shrink: 0;
}

/* Markdown Image Lightbox Cursor */
:deep(.markdown-body img) {
  cursor: zoom-in;
  border-radius: 6px;
  max-width: 100%;
  transition: transform 0.15s ease;
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
