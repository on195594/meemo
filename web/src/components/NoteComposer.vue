<template>
  <div
    ref="composerRef"
    @keydown.esc="handleKeyDown"
    class="note-composer-card"
    :class="{ focused: isExpanded, dragging: isDragging, 'is-tinted': selectedColor !== 'default' }"
    :style="{ backgroundColor: 'var(--note-color-' + selectedColor + ')' }"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="handleDrop"
  >
    <input
      v-if="isExpanded"
      v-model="title"
      class="composer-title"
      type="text"
      placeholder="Title"
      aria-label="Title"
      :disabled="isSaving"
      @focus="isFocused = true"
      @blur="handleBlur"
      @keydown="handleKeyDown"
    />

    <div class="composer-body">
      <textarea
        ref="textareaRef"
        v-model="content"
        class="composer-textarea"
        placeholder="Take a note…"
        aria-label="Write a note"
        rows="1"
        :disabled="isSaving"
        @focus="isFocused = true"
        @blur="handleBlur"
        @keydown="handleKeyDown"
        @paste="handlePaste"
      ></textarea>

      <div v-if="!isExpanded" class="quick-actions">
        <button type="button" class="btn-icon" title="New list" aria-label="New list" @click="startChecklist">
          <UiIcon name="checkbox" />
        </button>
        <button type="button" class="btn-icon" title="New note with image" aria-label="New note with image" @click="triggerFileSelect">
          <UiIcon name="image" />
        </button>
      </div>
    </div>

    <!-- Upload Progress Indicator -->
    <div v-if="isUploading" class="upload-progress-box">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ transform: `scaleX(${uploadProgress / 100})` }"></div>
      </div>
      <span class="progress-text">Uploading {{ uploadingFileName }}… {{ uploadProgress }}%</span>
    </div>

    <!-- Attached Files Preview List -->
    <div v-if="attachments.length > 0" class="composer-attachments">
      <div
        v-for="(att, idx) in attachments"
        :key="att.identifier"
        class="attachment-chip"
      >
        <UiIcon :name="isImageAttachment(att) ? 'image' : 'attach'" />
        <span class="chip-name">{{ att.fileName || att.identifier }}</span>
        <button
          type="button"
          class="chip-remove"
          title="Remove attachment"
          :aria-label="`Remove attachment ${att.fileName || att.identifier}`"
          @click="removeAttachment(idx)"
        >
          <UiIcon name="close" />
        </button>
      </div>
    </div>

    <!-- Error Banner -->
    <div v-if="error" class="composer-error" role="alert">
      {{ error }}
    </div>

    <input
      ref="fileInputRef"
      type="file"
      class="hidden-file-input"
      multiple
      @change="handleFileInputChange"
    />

    <!-- Toolbar (expanded) -->
    <div v-show="isExpanded" class="composer-actions">
      <div class="left-actions">
        <div ref="colorPickerWrapperRef" class="composer-color-wrapper">
          <button
            ref="colorTriggerRef"
            type="button"
            class="btn-icon"
            :class="{ active: showColorPicker }"
            title="Note color"
            aria-label="Note color"
            :aria-controls="showColorPicker ? colorPaletteId : undefined"
            :aria-expanded="showColorPicker"
            @click="toggleColorPicker"
          >
            <UiIcon name="palette" />
          </button>
          <NoteColorPopover
            :open="showColorPicker"
            :id="colorPaletteId"
            :color="selectedColor"
            label="Note color"
            :anchor="colorTriggerRef"
            :wrapper="colorPickerWrapperRef"
            @navigate="selectedColor = $event"
            @select="selectColor"
            @close="closeColorPicker"
          />
        </div>

        <button
          type="button"
          class="btn-icon"
          title="Add image or file"
          aria-label="Attach file or image"
          :disabled="isSaving || isUploading"
          @click="triggerFileSelect"
        >
          <UiIcon name="image" />
        </button>
        <button type="button" class="btn-icon" title="Add checkbox item" aria-label="Add checkbox item" @click="startChecklist">
          <UiIcon name="checkbox" />
        </button>
      </div>

      <button
        type="button"
        class="btn-close"
        :disabled="isSaving || isUploading"
        @click="closeComposer"
      >
        <span v-if="isSaving">Saving…</span>
        <span v-else>Close</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import UiIcon from './UiIcon.vue';
import NoteColorPopover from './NoteColorPopover.vue';
import { api, type AttachmentDescriptor, type NoteColor } from '../api/client';
import { joinTitle } from '../utils/noteTitle';
import { isImageAttachment } from '../utils/markdown';
import { loadDraft, saveDraft } from '../utils/drafts';
import { shrinkImage } from '../utils/image';

const props = withDefaults(defineProps<{
  onSave: (content: string, attachments?: AttachmentDescriptor[], color?: NoteColor) => Promise<{ success: boolean; error?: string }>;
  // false while hidden (Archive/Trash) so clicks there don't trigger saves.
  active?: boolean;
  // Signed-in user ID; when set, the unsaved draft is kept on this device.
  draftScope?: string;
}>(), { active: true });

const emit = defineEmits<{
  (e: 'created'): void;
}>();

const selectedColor = ref<NoteColor>('default');
const showColorPicker = ref(false);
const composerRef = ref<HTMLElement | null>(null);
const colorPickerWrapperRef = ref<HTMLElement | null>(null);
const colorTriggerRef = ref<HTMLButtonElement | null>(null);
const colorPaletteId = `note-colors-${getCurrentInstance()!.uid}`;

const title = ref('');
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

const hasDraft = computed(() => !!(title.value.trim() || content.value.trim() || attachments.value.length));

// Mirror the unsaved composer to this device and bring it back after a reload or re-login.
type ComposerDraft = { title: string; content: string; attachments: AttachmentDescriptor[]; color: NoteColor };
const draftKey = computed(() => (props.draftScope ? `composer:${props.draftScope}` : null));
watch(draftKey, (key) => {
  const saved = loadDraft<ComposerDraft>(key);
  if (!saved || hasDraft.value) return;
  title.value = saved.title || '';
  content.value = saved.content || '';
  attachments.value = Array.isArray(saved.attachments) ? saved.attachments : [];
  selectedColor.value = saved.color || 'default';
}, { immediate: true });
watch([title, content, attachments, selectedColor], () => {
  saveDraft(draftKey.value, hasDraft.value
    ? { title: title.value, content: content.value, attachments: attachments.value, color: selectedColor.value }
    : null);
}, { deep: true });
const isExpanded = computed(() => isFocused.value || hasDraft.value);

function autosize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
watch(content, () => nextTick(autosize));

// Keep behavior: clicking anywhere outside the open composer saves (or collapses) it.
function handleOutsidePointer(event: PointerEvent) {
  if (!props.active) return;
  if (!composerRef.value?.contains(event.target as Node)) closeComposer();
}

// Drop focus only if it is still ours; an outside click may have moved it elsewhere.
function blurIfInside() {
  const el = document.activeElement as HTMLElement | null;
  if (el && composerRef.value?.contains(el)) el.blur();
}
watch(isExpanded, (open) => {
  if (open) document.addEventListener('pointerdown', handleOutsidePointer);
  else document.removeEventListener('pointerdown', handleOutsidePointer);
});

async function closeComposer() {
  closeColorPicker();
  if (hasDraft.value) {
    await handleSubmit();
    return;
  }
  isFocused.value = false;
  error.value = null;
  blurIfInside();
}

function startChecklist() {
  isFocused.value = true;
  if (!/^\s*- \[[ x]\] /m.test(content.value.split('\n').pop() || '')) {
    content.value += (content.value && !content.value.endsWith('\n') ? '\n' : '') + '- [ ] ';
  }
  nextTick(() => {
    const el = textareaRef.value;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
}
const fileInputRef = ref<HTMLInputElement | null>(null);

function handleBlur() {
  setTimeout(() => {
    const inside = composerRef.value?.contains(document.activeElement);
    if (!inside && !hasDraft.value && !showColorPicker.value) {
      isFocused.value = false;
    }
  }, 200);
}

function closeColorPicker(returnFocus = false) {
  const shouldRestoreFocus = returnFocus && showColorPicker.value;
  showColorPicker.value = false;
  if (shouldRestoreFocus) nextTick(() => colorTriggerRef.value?.focus());
}

function toggleColorPicker() {
  if (showColorPicker.value) {
    closeColorPicker();
    return;
  }
  showColorPicker.value = true;
}

function selectColor(color: NoteColor) {
  selectedColor.value = color;
  closeColorPicker(true);
}

onUnmounted(() => {
  document.removeEventListener('pointerdown', handleOutsidePointer);
});

function handleKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleSubmit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeComposer();
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
      const uploaded = await api.files.upload(await shrinkImage(file), (pct) => {
        uploadProgress.value = pct;
      });
      attachments.value.push(uploaded);

      // Append file reference token to content for non-image files (images display as Keep attachments)
      if (!isImageAttachment(uploaded)) {
        if (content.value.length > 0 && !content.value.endsWith(' ') && !content.value.endsWith('\n')) {
          content.value += ' ';
        }
        content.value += `[${uploaded.fileName || file.name}] `;
      }
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

async function handleSubmit() {
  const trimmed = joinTitle(title.value, content.value);
  if (!trimmed || isSaving.value || isUploading.value) return;

  isSaving.value = true;
  error.value = null;

  const hasCustomColor = selectedColor.value && selectedColor.value !== 'default';
  const result = hasCustomColor
    ? await props.onSave(trimmed, attachments.value, selectedColor.value)
    : await props.onSave(trimmed, attachments.value);
  if (result.success) {
    title.value = '';
    content.value = '';
    attachments.value = [];
    selectedColor.value = 'default';
    showColorPicker.value = false;
    isFocused.value = false;
    blurIfInside();
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
  position: relative;
  width: 100%;
  max-width: 600px;
  margin: 0 auto 32px;
  border: 1px solid var(--note-border-color);
  border-radius: var(--keep-card-radius);
  box-shadow: var(--keep-shadow-raised);
  transition: background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              box-shadow var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

.note-composer-card:not(.focused):hover {
  border-color: var(--note-border-hover);
}

:root[data-theme="dark"] .note-composer-card {
  box-shadow: none;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .note-composer-card {
    box-shadow: none;
  }
}

.note-composer-card.is-tinted {
  border-color: transparent;
}

.note-composer-card.dragging {
  outline: 2px dashed var(--md-sys-color-on-surface-variant);
  outline-offset: -6px;
}

.composer-title {
  display: block;
  width: 100%;
  padding: 12px 16px 0;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-title-medium);
  font-weight: 500;
  line-height: 1.5rem;
  letter-spacing: 0.00625em;
}

.composer-body {
  display: flex;
  align-items: flex-start;
}

.composer-textarea {
  flex: 1;
  min-width: 0;
  display: block;
  min-height: 46px;
  padding: 12px 16px;
  border: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-medium);
  line-height: 1.375rem;
  letter-spacing: 0.0142em;
}

.note-composer-card:not(.focused) .composer-textarea {
  font-size: var(--md-sys-typescale-title-medium);
  font-weight: 500;
}

.composer-title:focus-visible,
.composer-textarea:focus-visible {
  outline: none;
}

.composer-title::placeholder,
.composer-textarea::placeholder {
  color: var(--md-sys-color-on-surface-variant);
  opacity: 1;
}

.quick-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 1px 8px 0 0;
}

.upload-progress-box {
  padding: 0 16px;
  margin-top: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.progress-bar {
  height: 4px;
  background-color: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-xs);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: var(--md-sys-color-primary);
  transform-origin: left;
  transition: transform var(--md-sys-motion-duration-short) linear;
}

.progress-text {
  font-size: var(--md-sys-typescale-body-small);
  color: var(--md-sys-color-on-surface-variant);
}

.composer-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.25rem 16px 0;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  border-radius: var(--md-sys-shape-corner-full);
  padding: 0.15rem 0.25rem 0.15rem 0.6rem;
  font-size: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface);
}

.chip-remove {
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: none;
  border: none;
  border-radius: 50%;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}

.chip-remove .ui-icon,
.attachment-chip > .ui-icon {
  width: 14px;
  height: 14px;
}

.chip-remove:hover {
  color: var(--md-sys-color-error);
}

.composer-error {
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  border-radius: var(--md-sys-shape-corner-sm);
  padding: 0.5rem 0.75rem;
  font-size: var(--md-sys-typescale-body-medium);
  margin: 0.5rem 16px 0;
}

.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 46px;
  padding: 4px 15px 4px 8px;
}

.left-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.btn-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.btn-icon .ui-icon {
  width: 20px;
  height: 20px;
}

.btn-icon:hover:not(:disabled),
.btn-icon.active {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  color: var(--md-sys-color-on-surface);
}

.btn-icon:disabled {
  opacity: 0.38;
  cursor: not-allowed;
}

.composer-color-wrapper {
  position: relative;
  display: inline-flex;
}

.hidden-file-input {
  display: none;
}

.btn-close {
  min-height: var(--keep-control-size);
  padding: 0 24px;
  border: none;
  border-radius: var(--md-sys-shape-corner-xs);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  letter-spacing: 0.0178em;
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.btn-close:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
}

.btn-close:disabled {
  opacity: 0.6;
  cursor: wait;
}

@media (max-width: 599px) {
  .note-composer-card {
    margin-bottom: 16px;
  }
}
</style>
