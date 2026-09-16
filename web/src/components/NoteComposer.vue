<template>
  <div
    class="note-composer-card"
    :class="{ focused: isFocused || content.trim().length > 0 || attachments.length > 0, dragging: isDragging }"
    :style="{ backgroundColor: 'var(--note-color-' + selectedColor + ')' }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <div class="composer-body">
      <textarea
        ref="textareaRef"
        v-model="content"
        class="composer-textarea"
        placeholder="Write a note... (#tags, markdown supported, drag & drop images)"
        rows="3"
        :disabled="isSaving"
        @focus="isFocused = true"
        @blur="handleBlur"
        @keydown="handleKeyDown"
        @paste="handlePaste"
      ></textarea>
    </div>

    <!-- Upload Progress Indicator -->
    <div v-if="isUploading" class="upload-progress-box">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
      </div>
      <span class="progress-text">Uploading {{ uploadingFileName }}... {{ uploadProgress }}%</span>
    </div>

    <!-- Attached Files Preview List -->
    <div v-if="attachments.length > 0" class="composer-attachments">
      <div
        v-for="(att, idx) in attachments"
        :key="att.identifier"
        class="attachment-chip"
      >
        <span class="chip-icon">{{ isImageAttachment(att) ? '🖼️' : '📎' }}</span>
        <span class="chip-name">{{ att.fileName || att.identifier }}</span>
        <button
          type="button"
          class="chip-remove"
          title="Remove attachment"
          @click="removeAttachment(idx)"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="error" class="composer-error" role="alert">
      {{ error }}
    </div>

    <!-- Action Bar (visible when focused or has content or attachments) -->
    <div v-show="isFocused || content.trim().length > 0 || attachments.length > 0" class="composer-actions">
      <div class="left-actions">
        <!-- Color Picker Popover Button -->
        <div class="composer-color-wrapper">
          <button
            type="button"
            class="btn-icon"
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
            aria-label="Note color"
          >
            <button
              v-for="c in NOTE_COLORS"
              :key="c.key"
              type="button"
              class="color-swatch-btn"
              :class="{ active: selectedColor === c.key }"
              :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
              :title="c.name"
              :aria-label="c.name"
              role="radio"
              :aria-checked="selectedColor === c.key"
              @click="selectedColor = c.key; showColorPicker = false"
            ></button>
          </div>
        </div>

        <!-- Attach File Button -->
        <button
          type="button"
          class="btn-icon"
          title="Attach file or image"
          :disabled="isSaving || isUploading"
          @click="triggerFileSelect"
        >
          📎
        </button>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file-input"
          multiple
          @change="handleFileInputChange"
        />
        <span class="shortcut-hint">
          <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to save
        </span>
      </div>

      <div class="btn-group">
        <button
          v-if="content.trim().length > 0 || attachments.length > 0"
          type="button"
          class="btn-composer secondary"
          :disabled="isSaving || isUploading"
          @click="handleCancel"
        >
          Clear
        </button>
        <button
          type="button"
          class="btn-composer primary"
          :disabled="isSaving || isUploading || !content.trim()"
          @click="handleSubmit"
        >
          <span v-if="isSaving">Saving...</span>
          <span v-else>Save Note</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api, type AttachmentDescriptor, type NoteColor } from '../api/client';

const props = defineProps<{
  onSave: (content: string, attachments?: AttachmentDescriptor[], color?: NoteColor) => Promise<{ success: boolean; error?: string }>;
}>();

const emit = defineEmits<{
  (e: 'created'): void;
}>();

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

const selectedColor = ref<NoteColor>('default');
const showColorPicker = ref(false);

const content = ref('');
const attachments = ref<AttachmentDescriptor[]>([]);
const isFocused = ref(false);
const isSaving = ref(false);
const isDragging = ref(false);
const isUploading = ref(false);
const uploadProgress = ref(0);
const uploadingFileName = ref('');
const error = ref<string | null>(null);

const textareaRef = ref<HTMLTextAreaElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

function isImageAttachment(att: AttachmentDescriptor): boolean {
  if (att.type === 'image') return true;
  if (att.mime?.startsWith('image/')) return true;
  const name = att.fileName?.toLowerCase() || '';
  return /\.(png|jpe?g|gif|webp|svg)$/.test(name);
}

function handleBlur() {
  setTimeout(() => {
    if (!content.value.trim() && attachments.value.length === 0) {
      isFocused.value = false;
    }
  }, 200);
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleSubmit();
  } else if (e.key === 'Escape' && !content.value.trim() && attachments.value.length === 0) {
    isFocused.value = false;
    textareaRef.value?.blur();
  }
}

function triggerFileSelect() {
  fileInputRef.value?.click();
}

function handleFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const files = target.files;
  if (files && files.length > 0) {
    uploadFiles(Array.from(files));
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    uploadFiles(Array.from(files));
  }
}

function handlePaste(event: ClipboardEvent) {
  const items = event.clipboardData?.items;
  if (!items) return;

  const filesToUpload: File[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) filesToUpload.push(file);
    }
  }

  if (filesToUpload.length > 0) {
    uploadFiles(filesToUpload);
  }
}

async function uploadFiles(files: File[]) {
  error.value = null;
  for (const file of files) {
    isUploading.value = true;
    uploadProgress.value = 0;
    uploadingFileName.value = file.name;

    try {
      const uploaded = await api.files.upload(file, (pct) => {
        uploadProgress.value = pct;
      });
      attachments.value.push(uploaded);

      // Append file reference token to content
      if (content.value.length > 0 && !content.value.endsWith(' ') && !content.value.endsWith('\n')) {
        content.value += ' ';
      }
      content.value += `[${uploaded.fileName || file.name}] `;
    } catch (err: any) {
      error.value = err.message || `Failed to upload ${file.name}`;
      break;
    } finally {
      isUploading.value = false;
    }
  }
}

function removeAttachment(index: number) {
  const removed = attachments.value[index];
  attachments.value.splice(index, 1);
  if (removed?.fileName) {
    // Remove token from content if present
    content.value = content.value.replace(`[${removed.fileName}]`, '').trim();
  }
}

function handleCancel() {
  content.value = '';
  attachments.value = [];
  selectedColor.value = 'default';
  showColorPicker.value = false;
  error.value = null;
  isFocused.value = false;
  textareaRef.value?.blur();
}

async function handleSubmit() {
  const trimmed = content.value.trim();
  if (!trimmed || isSaving.value || isUploading.value) return;

  isSaving.value = true;
  error.value = null;

  const hasCustomColor = selectedColor.value && selectedColor.value !== 'default';
  const result = hasCustomColor
    ? await props.onSave(trimmed, attachments.value, selectedColor.value)
    : await props.onSave(trimmed, attachments.value);
  if (result.success) {
    content.value = '';
    attachments.value = [];
    selectedColor.value = 'default';
    showColorPicker.value = false;
    isFocused.value = false;
    emit('created');
  } else {
    error.value = result.error || 'Failed to save note';
  }
  isSaving.value = false;
}

function focus() {
  textareaRef.value?.focus();
}

defineExpose({
  focus,
  content,
});
</script>

<style scoped>
.note-composer-card {
  background-color: var(--note-color-default);
  border: 1px solid var(--note-border-color);
  border-radius: var(--md-sys-shape-corner-lg, 16px);
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  box-shadow: var(--md-sys-elevation-1);
  transition: border-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              box-shadow var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-composer-card:hover {
  border-color: var(--note-border-hover);
  box-shadow: var(--md-sys-elevation-2);
}

.note-composer-card.focused {
  border-color: var(--md-sys-color-primary);
  box-shadow: var(--md-sys-elevation-2), 0 0 0 2px var(--md-sys-color-primary-container);
}

.note-composer-card.dragging {
  border-color: var(--md-sys-color-primary);
  background-color: var(--md-sys-color-primary-container);
}

.composer-body {
  width: 100%;
}

.composer-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #2d3748;
}

.composer-textarea::placeholder {
  color: #a0aec0;
}

.upload-progress-box {
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.progress-bar {
  height: 6px;
  background-color: #edf2f7;
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #3182ce;
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 0.75rem;
  color: #718096;
}

.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px dashed #edf2f7;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background-color: #edf2f7;
  border: 1px solid #cbd5e0;
  border-radius: 12px;
  padding: 0.15rem 0.5rem;
  font-size: 0.8rem;
  color: #4a5568;
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

.composer-error {
  background-color: #fff5f5;
  color: #c53030;
  border: 1px solid #fed7d7;
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.composer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid #edf2f7;
}

.left-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.btn-icon {
  background: none;
  border: 1px solid transparent;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  cursor: pointer;
  font-size: 0.95rem;
  padding: 0.35rem 0.45rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: all var(--md-sys-motion-duration-short) ease;
}

/* Expand touch target to min 48x48px on pointer/touch */
.btn-icon::after {
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

.btn-icon:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.btn-icon:hover:not(:disabled) {
  background-color: rgba(60, 64, 67, 0.08);
}

.btn-icon.active {
  background-color: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}

.composer-color-wrapper {
  position: relative;
  display: inline-flex;
}

.color-palette-popover {
  position: absolute;
  bottom: 100%;
  left: 0;
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

.hidden-file-input {
  display: none;
}

.shortcut-hint {
  font-size: 0.75rem;
  color: var(--md-sys-color-on-surface-variant, #718096);
}

.shortcut-hint kbd {
  background: rgba(60, 64, 67, 0.08);
  border: 1px solid var(--md-sys-color-outline-variant, #cbd5e0);
  border-radius: var(--md-sys-shape-corner-xs, 4px);
  padding: 0.1rem 0.35rem;
  font-size: 0.7rem;
  font-family: inherit;
}

.btn-group {
  display: flex;
  gap: 0.5rem;
}

.btn-composer {
  padding: 0.5rem 1.15rem;
  border-radius: var(--md-sys-shape-corner-full, 9999px);
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all var(--md-sys-motion-duration-short) ease;
}

.btn-composer:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 2px;
}

.btn-composer.primary {
  background-color: var(--md-sys-color-primary, #0b57d0);
  color: var(--md-sys-color-on-primary, #ffffff);
}

.btn-composer.primary:hover:not(:disabled) {
  box-shadow: var(--md-sys-elevation-1);
  opacity: 0.95;
}

.btn-composer.secondary {
  background-color: transparent;
  color: var(--md-sys-color-primary, #0b57d0);
}

.btn-composer.secondary:hover:not(:disabled) {
  background-color: rgba(60, 64, 67, 0.08);
}

.btn-composer:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
