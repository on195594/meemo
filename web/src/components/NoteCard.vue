<template>
  <article
    class="note-card"
    :class="{
      'is-sticky': thing.sticky,
      'is-archived': thing.archived,
      'is-editing': isEditing
    }"
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
      <div class="card-body markdown-body" v-html="renderedBody"></div>

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
import type { Thing, AttachmentDescriptor } from '../api/client';
import { renderMarkdown, highlightKeyword } from '../utils/markdown';

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
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 1.25rem 1.4rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease;
  position: relative;
}

.note-card:hover {
  box-shadow: 0 4px 12px -2px rgba(0, 0, 0, 0.08);
  border-color: #cbd5e1;
}

.note-card.is-sticky {
  border-left: 4px solid #3182ce;
  background-color: #fcfdfd;
}

.note-card.is-archived {
  opacity: 0.85;
  background-color: #fafbfc;
}

.note-card.is-editing {
  border-color: #3182ce;
  box-shadow: 0 0 0 2px rgba(49, 130, 206, 0.15);
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
  border-radius: 6px;
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0.2rem 0.35rem;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}

.action-btn:hover {
  background-color: #f1f5f9;
  border-color: #e2e8f0;
}

.action-btn.active {
  background-color: #ebf8ff;
  border-color: #bee3f8;
}

.action-btn.delete-btn:hover {
  background-color: #fff5f5;
  border-color: #fed7d7;
}

.card-body {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #2d3748;
  word-break: break-word;
  overflow-wrap: break-word;
}

.card-body :deep(mark) {
  background: #fef08a;
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
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
  background: #f7fafc;
  border: 1px solid #edf2f7;
  border-radius: 6px;
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
  background: #ffffff;
  border-radius: 8px;
  padding: 1.5rem;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
}

.delete-modal-card h3 {
  font-size: 1.15rem;
  color: #e53e3e;
  margin-bottom: 0.5rem;
}

.delete-modal-card p {
  font-size: 0.9rem;
  color: #4a5568;
  line-height: 1.5;
  margin-bottom: 1.25rem;
}

.delete-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.btn-modal {
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
}

.btn-modal.cancel {
  background-color: #edf2f7;
  color: #4a5568;
}

.btn-modal.cancel:hover:not(:disabled) {
  background-color: #e2e8f0;
}

.btn-modal.confirm-delete {
  background-color: #e53e3e;
  color: #ffffff;
}

.btn-modal.confirm-delete:hover:not(:disabled) {
  background-color: #c53030;
}
</style>
