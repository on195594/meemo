<template>
  <article
    class="note-card"
    :class="{
      'is-sticky': thing.sticky,
      'is-archived': thing.archived,
      'is-editing': isEditing
    }"
    :style="{ backgroundColor: 'var(--note-color-' + (thing.color || 'default') + ')' }"
  >
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
        <div class="color-picker-wrapper">
          <button
            type="button"
            class="action-btn color-btn"
            :class="{ active: showColorPicker }"
            title="Note color"
            aria-haspopup="true"
            :aria-expanded="showColorPicker"
            @click="showColorPicker = !showColorPicker"
          >
            🎨
          </button>
          <div
            v-if="showColorPicker"
            class="color-palette-popover"
            role="radiogroup"
            aria-label="Note card color"
          >
            <button
              v-for="c in NOTE_COLORS"
              :key="c.key"
              type="button"
              class="color-swatch-btn"
              :class="{ active: (thing.color || 'default') === c.key }"
              :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
              :title="c.name"
              :aria-label="c.name"
              role="radio"
              :aria-checked="(thing.color || 'default') === c.key"
              @click="selectColor(c.key)"
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

    <!-- Normal View: Markdown Content -->
    <template v-if="!isEditing">
      <div class="card-body markdown-body" v-html="renderedBody" @click="handleBodyClick"></div>

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
import { ref, computed, nextTick } from 'vue';
import type { Thing, AttachmentDescriptor, NoteColor } from '../api/client';
import { renderMarkdown, highlightKeyword } from '../utils/markdown';

const NOTE_COLORS: { key: NoteColor; name: string }[] = [
  { key: 'default', name: 'Default' },
  { key: 'coral', name: 'Coral' },
  { key: 'peach', name: 'Peach' },
  { key: 'sand', name: 'Sand' },
  { key: 'mint', name: 'Mint' },
  { key: 'sage', name: 'Sage' },
  { key: 'fog', name: 'Fog' },
  { key: 'storm', name: 'Storm' },
  { key: 'dusk', name: 'Dusk' },
  { key: 'blossom', name: 'Blossom' },
  { key: 'clay', name: 'Clay' },
  { key: 'chalk', name: 'Chalk' },
];

const showColorPicker = ref(false);

async function selectColor(color: NoteColor) {
  showColorPicker.value = false;
  if (props.onSaveEdit) {
    await props.onSaveEdit(props.thing._id, { color });
  } else {
    emit('update', props.thing._id, { color });
  }
}

const props = withDefaults(
  defineProps<{
    thing: Thing;
    canEdit?: boolean;
    highlightQuery?: string;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; error?: string }>;
    onDeleteConfirm?: (id: string) => Promise<{ success: boolean; error?: string }>;
  }>(),
  {
    canEdit: true,
    highlightQuery: '',
  }
);

const emit = defineEmits<{
  (e: 'tagClick', tag: string): void;
  (e: 'wikilinkClick', target: string): void;
  (e: 'toggleSticky', thing: Thing): void;
  (e: 'togglePublic', thing: Thing): void;
  (e: 'toggleArchive', thing: Thing): void;
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

function handleBodyClick(event: MouseEvent) {
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;

  const target = (event.target as HTMLElement)?.closest('a');
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
  margin-bottom: 1rem;
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
  color: #64748b;
}

.badge {
  font-size: 0.725rem;
  font-weight: 500;
  padding: 0.12rem 0.45rem;
  border-radius: 10px;
  line-height: 1.3;
}

.badge-sticky {
  background-color: #ebf8ff;
  color: #2b6cb0;
  border: 1px solid #bee3f8;
}

.badge-public {
  background-color: #f0fff4;
  color: #276749;
  border: 1px solid #c6f6d5;
}

.badge-shared {
  background-color: #faf5ff;
  color: #6b46c1;
  border: 1px solid #e9d8fd;
}

.badge-archived {
  background-color: #f7fafc;
  color: #475569;
  border: 1px solid #e2e8f0;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  opacity: 0;
  transition: opacity 0.2s ease;
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
  background-color: rgba(60, 64, 67, 0.08);
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
  grid-template-columns: repeat(6, 24px);
  gap: 6px;
  z-index: 50;
}

.color-swatch-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 1px solid var(--note-border-color);
  cursor: pointer;
  padding: 0;
  transition: transform 0.15s ease, border-color 0.15s ease;
}

.color-swatch-btn:hover,
.color-swatch-btn:focus-visible {
  transform: scale(1.15);
  outline: 2px solid var(--md-sys-color-primary);
}

.color-swatch-btn.active {
  box-shadow: 0 0 0 2px var(--md-sys-color-primary);
}

.card-body {
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--md-sys-color-on-surface, #1f1f1f);
  word-break: break-word;
  overflow-wrap: break-word;
}

.card-body :deep(mark) {
  background: #fef08a;
  color: #1f1f1f;
  border-radius: 2px;
  padding: 0 2px;
}

@media (prefers-color-scheme: dark) {
  .card-body :deep(mark) {
    background: #635d19;
    color: #ffffff;
  }
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
  border-top: 1px solid #edf2f7;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.attachment-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #3182ce;
  text-decoration: none;
}

.attachment-link:hover {
  text-decoration: underline;
}

.attachment-size {
  color: #a0aec0;
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
  background-color: #edf2f7;
  border: 1px solid transparent;
  color: #4a5568;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-pill:hover {
  background-color: #e2e8f0;
  color: #2b6cb0;
  border-color: #cbd5e0;
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
  border: 1px solid #cbd5e0;
  border-radius: 6px;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #2d3748;
  resize: vertical;
  outline: none;
}

.edit-textarea:focus {
  border-color: #3182ce;
}

.edit-error {
  background-color: #fff5f5;
  color: #c53030;
  border: 1px solid #fed7d7;
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
  color: #718096;
}

.edit-hint kbd {
  background: #edf2f7;
  border: 1px solid #cbd5e0;
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
  transition: all 0.2s;
}

.btn-edit.primary {
  background-color: #2b6cb0;
  color: #ffffff;
  border: 1px solid transparent;
}

.btn-edit.primary:hover:not(:disabled) {
  background-color: #2c5282;
}

.btn-edit.secondary {
  background-color: transparent;
  color: #718096;
  border: 1px solid #cbd5e0;
}

.btn-edit.secondary:hover:not(:disabled) {
  background-color: #edf2f7;
  color: #2d3748;
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
  background-color: rgba(60, 64, 67, 0.08);
}

.btn-modal.confirm-delete {
  background-color: var(--md-sys-color-error, #ba1a1a);
  color: var(--md-sys-color-on-error, #ffffff);
}

.btn-modal.confirm-delete:hover:not(:disabled) {
  opacity: 0.9;
}
</style>
