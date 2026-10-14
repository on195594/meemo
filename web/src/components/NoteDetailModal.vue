<template>
  <Teleport to="body">
    <Transition name="note-modal-fade">
      <div
        v-if="open && thing"
        ref="overlayRef"
        class="note-modal-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Edit note"
        tabindex="-1"
        @click="handleBackdropClick"
        @keydown="handleWindowKeydown"
      >
        <div
          class="note-modal-card"
          :class="{ 'is-tinted': (currentNote.color || 'default') !== 'default' }"
          :style="{ backgroundColor: 'var(--note-color-' + (currentNote.color || 'default') + ')' }"
          @click.stop
        >
          <div class="modal-scroll">
            <!-- Edge-to-edge image attachments -->
            <div v-if="imageAttachments.length > 0" class="modal-images">
              <a
                v-for="att in imageAttachments"
                :key="att.identifier"
                :href="attachmentUrl(att)"
                target="_blank"
                rel="noopener"
                class="modal-image-link"
                @click="handleAttachmentClick($event, att)"
              >
                <img :src="attachmentUrl(att)" :alt="att.fileName || ''" />
              </a>
            </div>

            <header class="modal-header">
              <input
                v-if="canEdit"
                v-model="titleDraft"
                class="modal-title-input"
                type="text"
                placeholder="Title"
                aria-label="Title"
                @keydown="handleTextareaKeydown"
                @input="handleTextareaInput"
              />
              <h2 v-else-if="titleDraft" class="modal-title-input">{{ titleDraft }}</h2>
              <span v-else class="modal-title-spacer"></span>

              <button
                v-if="canEdit"
                type="button"
                class="action-btn pin-btn"
                :class="{ active: currentNote.sticky }"
                :title="currentNote.sticky ? 'Unpin note' : 'Pin note'"
                :aria-label="currentNote.sticky ? 'Unpin note' : 'Pin note to top'"
                :aria-pressed="Boolean(currentNote.sticky)"
                @click="togglePin"
              >
                <UiIcon name="pin" />
              </button>
            </header>

            <!-- Error Alert Banner -->
            <div v-if="actionError" class="modal-error-banner" role="alert">
              {{ actionError }}
            </div>

            <main class="modal-body">
              <textarea
                v-if="canEdit"
                ref="textareaRef"
                v-model="bodyDraft"
                class="modal-textarea"
                placeholder="Note"
                aria-label="Note"
                rows="1"
                @keydown="handleTextareaKeydown"
                @input="handleTextareaInput"
              ></textarea>
              <div
                v-else
                ref="renderedBodyRef"
                class="modal-markdown-body markdown-body"
                v-html="renderedHtml"
                @click="handleBodyClick"
              ></div>

              <div v-if="fileAttachments.length > 0" class="modal-attachments">
                <a
                  v-for="att in fileAttachments"
                  :key="att.identifier"
                  :href="attachmentUrl(att)"
                  target="_blank"
                  rel="noopener"
                  class="attachment-anchor"
                  :title="att.fileName || att.identifier"
                >
                  <UiIcon name="attach" />
                  <span class="att-name">{{ att.fileName || att.identifier }}</span>
                  <span v-if="att.size" class="att-size">{{ formatFileSize(att.size) }}</span>
                </a>
              </div>

              <div v-if="currentNote.public || currentNote.shared" class="modal-status">
                <span v-if="currentNote.public" class="status-chip"><UiIcon name="globe" /> Public</span>
                <span v-if="currentNote.shared" class="status-chip"><UiIcon name="attach" /> Shared</span>
              </div>

              <time class="edited-at" :datetime="isoDate" :title="fullDate">{{ editedLabel }}</time>
            </main>
          </div>

          <!-- Keep-style bottom toolbar -->
          <footer class="modal-footer">
            <div v-if="canEdit" class="footer-actions">
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
                  <UiIcon name="palette" />
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
                    :class="{ active: (currentNote.color || 'default') === c.key, 'is-default': c.key === 'default' }"
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

              <button
                type="button"
                class="action-btn"
                :class="{ active: currentNote.archived }"
                :title="currentNote.archived ? 'Unarchive' : 'Archive'"
                :aria-label="currentNote.archived ? 'Restore note from archive' : 'Archive note'"
                @click="toggleArchive"
              >
                <UiIcon :name="currentNote.archived ? 'restore' : 'archive'" />
              </button>

              <button
                type="button"
                class="action-btn"
                :class="{ active: currentNote.public }"
                :title="currentNote.public ? 'Make private' : 'Make public'"
                :aria-label="currentNote.public ? 'Make note private' : 'Make note public'"
                :aria-pressed="Boolean(currentNote.public)"
                @click="togglePublic"
              >
                <UiIcon name="globe" />
              </button>

              <button
                type="button"
                class="action-btn delete-btn"
                title="Delete note"
                aria-label="Move note to trash"
                @click="requestDelete"
              >
                <UiIcon name="trash" />
              </button>
            </div>
            <div v-else class="footer-placeholder"></div>

            <div class="footer-right">
              <span v-if="isSaving" class="save-status" role="status">Saving…</span>
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
import UiIcon from './UiIcon.vue';
import { splitTitle, joinTitle } from '../utils/noteTitle';

const props = withDefaults(
  defineProps<{
    open: boolean;
    thing: Thing | null;
    canEdit?: boolean;
    highlightQuery?: string;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; thing?: Thing; error?: string }>;
  }>(),
  {
    canEdit: true,
    highlightQuery: '',
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'update', id: string, updates: Partial<Thing>): void;
  (e: 'toggleSticky', thing: Thing): void;
  (e: 'togglePublic', thing: Thing): void;
  (e: 'toggleArchive', thing: Thing): void;
  (e: 'delete', thing: Thing): void;
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

// Keep-style editing: the leading `# ` line is edited as a separate title field.
const titleDraft = ref('');
const bodyDraft = ref('');
const editDraft = computed(() => joinTitle(titleDraft.value, bodyDraft.value));
function setDraft(content: string) {
  const parts = splitTitle(content);
  titleDraft.value = parts.title;
  bodyDraft.value = parts.body;
  nextTick(autosize);
}
const isSaving = ref(false);
const isColorSaving = ref(false);
const isTaskSaving = ref(false);
const actionError = ref<string | null>(null);
let draftGeneration = 0;

const showColorPicker = ref(false);
const focusedColorIndex = ref(0);

const overlayRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function autosize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}
const renderedBodyRef = ref<HTMLElement | null>(null);
const colorWrapperRef = ref<HTMLElement | null>(null);
const colorTriggerRef = ref<HTMLButtonElement | null>(null);
const colorPaletteRef = ref<HTMLElement | null>(null);

const hasUnsavedChanges = computed(() => {
  if (!props.canEdit || !currentNote.value) return false;
  // Compare normalized forms so merely opening a note never rewrites it.
  const original = splitTitle(currentNote.value.content || '');
  return editDraft.value !== joinTitle(original.title, original.body);
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

const editedLabel = computed(() => {
  const d = new Date(dateValue.value);
  if (isNaN(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  return 'Edited ' + (sameDay
    ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }));
});

const renderedHtml = computed(() => {
  const html = renderMarkdown(currentNote.value.richContent || currentNote.value.content || '');
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

const imageAttachments = computed(() => (currentNote.value.attachments || []).filter(isImageAttachment));
const fileAttachments = computed(() => (currentNote.value.attachments || []).filter((att) => !isImageAttachment(att)));

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
          setDraft(currentNote.value.content || '');
        } else {
          checkbox.checked = wasChecked;
          actionError.value = result.error || 'Failed to update task';
        }
      } else {
        emit('update', currentNote.value._id, { content: updatedContent });
        currentNote.value.content = updatedContent;
        setDraft(updatedContent);
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
}

function handleTextareaInput() {
  draftGeneration++;
  actionError.value = null;
  autosize();
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
          setDraft(currentNote.value.content || '');
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

function requestDelete() {
  if (!currentNote.value) return;
  emit('delete', props.thing || currentNote.value);
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
        setDraft(props.thing.content || '');
        draftGeneration = 0;
        nextTick(() => overlayRef.value?.focus());
      }
    } else {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleWindowKeydown);
      closeColorPicker();
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
        setDraft(newThing.content || '');
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
.note-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background-color: rgba(32, 33, 36, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  overflow: hidden;
}

:root[data-theme="dark"] .note-modal-overlay {
  background-color: rgba(0, 0, 0, 0.6);
}

.note-modal-overlay:focus {
  outline: none;
}

.note-modal-card {
  width: min(600px, 100%);
  max-height: calc(100vh - 2rem);
  display: flex;
  flex-direction: column;
  color: var(--md-sys-color-on-surface);
  border: 1px solid var(--note-border-color);
  border-radius: var(--keep-card-radius);
  box-shadow: var(--keep-shadow-dialog);
  position: relative;
  overflow: hidden;
  transition: background-color var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.note-modal-card.is-tinted {
  border-color: transparent;
}

.modal-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.modal-images {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 2px;
}

.modal-image-link img {
  display: block;
  width: 100%;
  max-height: 420px;
  object-fit: cover;
  cursor: zoom-in;
}

.modal-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 8px 0 16px;
}

.modal-title-input {
  flex: 1;
  min-width: 0;
  min-height: 34px;
  padding: 6px 0;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-title-large);
  font-weight: 400;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.modal-title-spacer {
  flex: 1;
}

.modal-title-input:focus-visible,
.modal-textarea:focus-visible {
  outline: none;
}

.modal-title-input::placeholder,
.modal-textarea::placeholder {
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.85;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.action-btn:hover {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  color: var(--md-sys-color-on-surface);
}

.action-btn.active {
  color: var(--md-sys-color-on-surface);
}

.action-btn:disabled {
  cursor: wait;
}

.pin-btn {
  width: 40px;
  height: 40px;
}

.pin-btn.active :deep(path) {
  fill: currentColor;
}

.pin-btn .ui-icon {
  width: 22px;
  height: 22px;
}

.modal-error-banner {
  margin: 8px 16px 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--md-sys-shape-corner-xs);
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-medium);
}

.modal-body {
  display: flex;
  flex-direction: column;
  padding: 4px 16px 0;
}

.modal-textarea {
  display: block;
  width: 100%;
  min-height: 46px;
  padding: 8px 0 12px;
  border: none;
  resize: none;
  overflow: hidden;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.5;
  letter-spacing: 0.00625em;
}

.modal-markdown-body {
  padding: 8px 0 12px;
  font-size: var(--md-sys-typescale-body-large);
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.modal-markdown-body :deep(h1:first-child) {
  display: none;
}

.modal-markdown-body :deep(> * + *) {
  margin-top: 0.5rem;
}

.modal-markdown-body :deep(.task-list) {
  list-style: none;
  padding-left: 0;
}

.modal-markdown-body :deep(.task-list-item) {
  display: flex;
  gap: 0.5rem;
}

.modal-markdown-body :deep(.task-list-item.is-completed) {
  text-decoration: line-through;
  opacity: 0.65;
}

.modal-attachments {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-bottom: 8px;
}

.attachment-anchor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-medium);
  text-decoration: none;
}

.attachment-anchor:hover .att-name {
  text-decoration: underline;
}

.att-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.att-size {
  flex-shrink: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-small);
}

.modal-status {
  display: flex;
  gap: 6px;
  padding-bottom: 8px;
}

.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  font-size: var(--md-sys-typescale-label-medium);
}

.status-chip .ui-icon {
  width: 14px;
  height: 14px;
}

.edited-at {
  align-self: flex-end;
  padding: 4px 0 8px;
  font-size: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.modal-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 46px;
  padding: 4px 15px 4px 8px;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
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

.color-swatch-btn.is-default {
  box-shadow: inset 0 0 0 2px var(--md-sys-color-outline-variant);
}

.footer-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.save-status {
  font-size: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.done-btn {
  min-height: 36px;
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

.done-btn:hover {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
}

.done-btn:disabled {
  opacity: 0.6;
  cursor: wait;
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
  transform: scale(0.97) translateY(6px);
}

@media (max-width: 600px) {
  .note-modal-overlay {
    padding: 0;
    align-items: stretch;
  }

  .note-modal-card {
    width: 100%;
    max-height: none;
    border-radius: 0;
    border: none;
  }
}
</style>
