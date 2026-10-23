<template>
  <article
    class="note-card"
    :data-note-id="thing._id"
    :class="{
      'is-sticky': thing.sticky,
      'is-selected': selected,
      'is-selecting': selectable,
      'is-tinted': (thing.color || 'default') !== 'default',
      'is-clickable': hasOpenDetailListener,
      'has-menu-open': showColorPicker || showMoreMenu
    }"
    :style="{ backgroundColor: 'var(--note-color-' + (thing.color || 'default') + ')' }"
    :tabindex="hasOpenDetailListener ? 0 : undefined"
    :aria-haspopup="hasOpenDetailListener ? 'dialog' : undefined"
    @click="handleCardClick"
    @keydown="handleCardKeydown"
    @touchstart.passive="handleTouchStart"
    @touchmove.passive="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchCancel"
  >
    <!-- Keep-style edge-to-edge image attachments -->
    <div v-if="imageAttachments.length > 0" class="card-images" :class="{ 'is-multi': imageAttachments.length > 1 }">
      <a
        v-for="att in imageAttachments"
        :key="att.identifier"
        :href="attachmentUrl(att)"
        target="_blank"
        rel="noopener"
        class="attachment-link card-image-link"
        @click="handleAttachmentClick($event, att)"
      >
        <img :src="attachmentUrl(att)" :alt="att.fileName || ''" loading="lazy" />
      </a>
    </div>

    <!-- Selection Checkbox Button -->
    <button
      v-if="canEdit"
      type="button"
      class="card-select-btn"
      :class="{ 'is-selected': selected, 'is-visible': selectable || selected }"
      :title="selected ? 'Deselect note' : 'Select note'"
      :aria-label="selected ? 'Deselect note' : 'Select note'"
      :aria-pressed="selected"
      @click.stop="$emit('toggleSelect', thing)"
    >
      <UiIcon name="check" />
    </button>

    <!-- Pin Toggle (top-right, Keep style) -->
    <button
      v-if="canEdit"
      type="button"
      class="action-btn card-pin-btn"
      :class="{ active: thing.sticky }"
      :title="thing.sticky ? 'Unpin note' : 'Pin note'"
      :aria-label="thing.sticky ? 'Unpin note' : 'Pin note'"
      :aria-pressed="!!thing.sticky"
      @click.stop="$emit('toggleSticky', thing)"
    >
      <UiIcon name="pin" />
    </button>

    <div v-if="actionError" class="action-error" role="alert">
      {{ actionError }}
    </div>

    <div v-if="renderedBody || !imageAttachments.length" ref="cardBodyRef" class="card-body markdown-body" v-html="renderedBody" @click="handleBodyClick"></div>
    <p v-if="bodyPreview.truncated" class="card-preview-hint">Open note to read more</p>

    <!-- Non-image attachments -->
    <div v-if="fileAttachments.length > 0" class="card-attachments">
      <a
        v-for="att in fileAttachments"
        :key="att.identifier"
        :href="attachmentUrl(att)"
        target="_blank"
        rel="noopener"
        class="attachment-link"
        @click="handleAttachmentClick($event, att)"
      >
        <UiIcon name="attach" />
        <span class="attachment-name">{{ att.fileName || att.identifier }}</span>
        <span v-if="att.size" class="attachment-size">{{ formatFileSize(att.size) }}</span>
      </a>
    </div>

    <!-- Status chips -->
    <footer v-if="thing.public || thing.shared || !canEdit" class="card-footer">
      <span v-if="thing.public" class="status-chip" title="Visible on your public stream">
        <UiIcon name="globe" /> Public
      </span>
      <span v-if="thing.shared" class="status-chip" title="Shared by link">
        <UiIcon name="attach" /> Shared
      </span>
      <time v-if="!canEdit" :datetime="isoDate" :title="fullDate" class="note-time">{{ relativeDate }}</time>
    </footer>

    <!-- Hover toolbar -->
    <div v-if="canEdit || onRestore" class="card-actions" role="group" aria-label="Note actions" @click.stop>
      <button
        v-if="onRestore"
        type="button"
        class="action-btn"
        title="Restore note"
        aria-label="Restore note"
        @click="onRestore(thing)"
      >
        <UiIcon name="restore" />
      </button>

      <template v-if="canEdit">
        <!-- Color Picker Popover -->
        <div ref="colorPickerWrapperRef" class="color-picker-wrapper">
          <button
            ref="colorTriggerRef"
            type="button"
            class="action-btn color-btn"
            :class="{ active: showColorPicker }"
            title="Note color"
            aria-label="Note color"
            :aria-controls="showColorPicker ? colorPaletteId : undefined"
            :aria-expanded="showColorPicker"
            :disabled="isColorSaving"
            @click="toggleColorPicker"
          >
            <UiIcon name="palette" />
          </button>
          <div
            v-if="showColorPicker"
            ref="colorPaletteRef"
            :id="colorPaletteId"
            class="color-palette-popover"
            role="group"
            aria-label="Note card color"
          >
            <button
              v-for="(c, index) in NOTE_COLORS"
              :key="c.key"
              type="button"
              class="color-swatch-btn"
              :class="{ active: (thing.color || 'default') === c.key, 'is-default': c.key === 'default' }"
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

        <ActionMenu v-model:open="showMoreMenu" label="More note actions" :disabled="isColorSaving || duplicating" @update:open="onMoreMenuChange">
          <template #trigger><UiIcon name="more" /></template>
          <button v-if="onDuplicate" type="button" role="menuitem" tabindex="-1" aria-label="Make a copy" @click="makeCopy">
            <UiIcon name="copy" /> Make a copy
          </button>
          <button type="button" role="menuitem" tabindex="-1" :aria-label="thing.archived ? 'Unarchive note' : 'Archive note'" @click="$emit('toggleArchive', thing)">
            <UiIcon :name="thing.archived ? 'restore' : 'archive'" /> {{ thing.archived ? 'Unarchive' : 'Archive' }}
          </button>
          <button type="button" role="menuitem" tabindex="-1" :aria-label="thing.public ? 'Make private' : 'Make public'" @click="$emit('togglePublic', thing)">
            <UiIcon name="globe" /> {{ thing.public ? 'Make private' : 'Make public' }}
          </button>
          <button type="button" role="menuitem" tabindex="-1" class="menu-danger delete-btn" aria-label="Delete note" @click="$emit('delete', thing)">
            <UiIcon name="trash" /> Delete note
          </button>
        </ActionMenu>
      </template>
    </div>
  </article>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, onUnmounted, getCurrentInstance } from 'vue';
import UiIcon from './UiIcon.vue';
import ActionMenu from './ActionMenu.vue';
import { usePopoverPosition } from '../composables/usePopoverPosition';
import type { Thing, AttachmentDescriptor, NoteColor } from '../api/client';
import { NOTE_COLORS } from '../constants/noteColors';
import { renderMarkdown, highlightKeyword, toggleTaskItem, stripImageAttachmentReferences, isImageAttachment } from '../utils/markdown';
import type { LightboxImage } from './ImageLightbox.vue';

const showColorPicker = ref(false);
const showMoreMenu = ref(false);
const isColorSaving = ref(false);
const actionError = ref<string | null>(null);
async function makeCopy() {
  if (!props.canEdit || !props.onDuplicate || props.duplicating) return;
  actionError.value = null;
  try {
    const result = await props.onDuplicate(props.thing);
    if (!result.success) actionError.value = result.error || 'Could not create copy. Try again.';
  } catch (error) {
    actionError.value = error instanceof Error ? error.message : 'Could not create copy. Try again.';
  }
  await nextTick();
  if (document.activeElement === document.body && !document.querySelector('.note-modal-overlay')) {
    const card = document.querySelector(`[data-note-id="${props.thing._id}"]`);
    card?.querySelector<HTMLButtonElement>('[aria-label="More note actions"]')?.focus();
  }
}
const focusedColorIndex = ref(0);
const colorPickerWrapperRef = ref<HTMLElement | null>(null);
const colorTriggerRef = ref<HTMLButtonElement | null>(null);
const colorPaletteRef = ref<HTMLElement | null>(null);
usePopoverPosition(colorTriggerRef, colorPaletteRef, showColorPicker);

function onMoreMenuChange(open: boolean) {
  if (open) closeColorPicker();
}

function focusColor(index: number) {
  focusedColorIndex.value = index;
  nextTick(() => {
    colorPaletteRef.value?.querySelectorAll<HTMLButtonElement>('.color-swatch-btn')[index]?.focus();
  });
}

function closeColorPicker(returnFocus = false) {
  const shouldRestoreFocus = returnFocus && showColorPicker.value;
  showColorPicker.value = false;
  document.removeEventListener('pointerdown', handleOutsideColorPicker);
  document.removeEventListener('focusin', handleOutsideColorPicker);
  if (shouldRestoreFocus) nextTick(() => {
    // Saving can move the note between masonry columns and replace its card.
    const card = Array.from(document.querySelectorAll<HTMLElement>('.note-card')).find(el => el.dataset.noteId === props.thing._id);
    (colorTriggerRef.value || card?.querySelector<HTMLButtonElement>('.color-btn'))?.focus();
  });
}

function toggleColorPicker() {
  if (showColorPicker.value) {
    closeColorPicker();
    return;
  }
  actionError.value = null;
  showColorPicker.value = true;
  document.addEventListener('pointerdown', handleOutsideColorPicker);
  document.addEventListener('focusin', handleOutsideColorPicker);
  const selected = NOTE_COLORS.findIndex((color) => color.key === (props.thing.color || 'default'));
  focusColor(selected < 0 ? 0 : selected);
}

function handleColorKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
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

function handleOutsideColorPicker(event: Event) {
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
  clearTouchTimer();
  if (touchResetTimer) clearTimeout(touchResetTimer);
  document.removeEventListener('pointerdown', handleOutsideColorPicker);
  document.removeEventListener('focusin', handleOutsideColorPicker);
});

const props = withDefaults(
  defineProps<{
    thing: Thing;
    canEdit?: boolean;
    selectable?: boolean;
    selected?: boolean;
    highlightQuery?: string;
    duplicating?: boolean;
    onDuplicate?: (thing: Thing) => Promise<{ success: boolean; error?: string }>;
    onSaveEdit?: (id: string, updates: Partial<Thing>) => Promise<{ success: boolean; error?: string }>;
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
  (e: 'delete', thing: Thing): void;
  (e: 'openDetail', thing: Thing): void;
}>();

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

function attachmentUrl(att: AttachmentDescriptor): string {
  return `/api/files/${props.thing.ownerId || 'me'}/${props.thing._id}/${att.identifier}`;
}

const imageAttachments = computed(() => (props.thing.attachments || []).filter(isImageAttachment));
const fileAttachments = computed(() => (props.thing.attachments || []).filter((att) => !isImageAttachment(att)));

const bodyPreview = computed(() => {
  const raw = props.thing.richContent || props.thing.content || '';
  const stripped = stripImageAttachmentReferences(raw, imageAttachments.value);
  if (!hasOpenDetailListener.value) return { content: stripped, truncated: false };
  // Bound parsing and DOM work when saves move cards between masonry columns.
  const content = stripped.slice(0, 4000).split('\n', 40).join('\n').replace(/[\uD800-\uDBFF]$/, '');
  return { content, truncated: content.length < stripped.trimEnd().length };
});
const renderedMarkdown = computed(() => renderMarkdown(bodyPreview.value.content));
const renderedBody = computed(() => {
  const html = renderedMarkdown.value;
  return props.highlightQuery ? highlightKeyword(html, props.highlightQuery) : html;
});

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const instance = getCurrentInstance();
const colorPaletteId = `note-colors-${instance!.uid}`;
const hasOpenDetailListener = computed(() => Boolean(instance?.vnode.props?.onOpenDetail));

let touchTimer: ReturnType<typeof setTimeout> | null = null;
let touchResetTimer: ReturnType<typeof setTimeout> | null = null;
let touchStartX = 0;
let touchStartY = 0;
let didLongPress = false;

function handleTouchStart(event: TouchEvent) {
  if (event.touches.length !== 1 || !props.canEdit) return;
  const target = event.target as Element | null;
  if (target?.closest('button, a, input, .card-actions') ||
      (target?.closest('img') && hasImageClickListener.value)) return;
  const touch = event.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
  clearTouchTimer();
  touchTimer = setTimeout(() => {
    touchTimer = null;
    didLongPress = true;
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try { navigator.vibrate(40); } catch (_) {}
    }
    emit('toggleSelect', props.thing);
  }, 500);
}

function handleTouchMove(event: TouchEvent) {
  if (!touchTimer || event.touches.length !== 1) return;
  const touch = event.touches[0];
  if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
    clearTouchTimer();
  }
}

function handleTouchEnd() {
  clearTouchTimer();
  if (didLongPress) {
    if (touchResetTimer) clearTimeout(touchResetTimer);
    touchResetTimer = setTimeout(() => {
      didLongPress = false;
      touchResetTimer = null;
    }, 400);
  }
}

function handleTouchCancel() {
  clearTouchTimer();
  didLongPress = false;
  if (touchResetTimer) {
    clearTimeout(touchResetTimer);
    touchResetTimer = null;
  }
}

function clearTouchTimer() {
  if (touchTimer) {
    clearTimeout(touchTimer);
    touchTimer = null;
  }
}

function handleCardClick(event: MouseEvent) {
  if (didLongPress) {
    didLongPress = false;
    if (touchResetTimer) {
      clearTimeout(touchResetTimer);
      touchResetTimer = null;
    }
    return;
  }
  if (!hasOpenDetailListener.value) return;
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;

  // Don't open detail if user was selecting text within this card
  const selection = window.getSelection();
  if (selection && selection.toString().trim().length > 0) {
    const card = event.currentTarget as HTMLElement | null;
    const anchor = selection.anchorNode;
    if (!anchor || (card && card.contains(anchor))) return;
  }

  const target = event.target as HTMLElement | null;
  if (!target) return;

  if (
    target.closest('.card-select-btn') ||
    target.closest('.card-pin-btn') ||
    target.closest('.card-actions') ||
    target.closest('.task-list-item-checkbox') ||
    target.closest('.attachment-link') ||
    target.closest('a')
  ) {
    return;
  }

  if (target.closest('img') && hasImageClickListener.value) {
    return;
  }

  emit('openDetail', props.thing);
}

function handleCardKeydown(event: KeyboardEvent) {
  if (event.target !== event.currentTarget || !hasOpenDetailListener.value) return;
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    emit('openDetail', props.thing);
  }
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

</script>

<style scoped>
.note-card {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--note-border-color);
  border-radius: var(--keep-card-radius);
  color: var(--md-sys-color-on-surface);
  transition: transform var(--md-sys-motion-duration-short) cubic-bezier(0.2, 0, 0, 1),
              box-shadow var(--md-sys-motion-duration-short) ease,
              border-color var(--md-sys-motion-duration-short) ease;
}

/* Keep drops the outline on colored notes; the fill is the edge. */
.note-card.is-tinted {
  border-color: transparent;
}

.note-card:hover,
.note-card:focus-within,
.note-card.has-menu-open {
  transform: translateY(-2px);
  box-shadow: var(--keep-shadow-hover);
  border-color: transparent;
  z-index: 1;
}

.note-card.is-clickable {
  cursor: default;
}

.note-card.is-clickable .card-body {
  max-height: 400px;
  overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 340px, transparent 400px);
  mask-image: linear-gradient(to bottom, #000 340px, transparent 400px);
}

.note-card.has-menu-open {
  z-index: 10;
}

.note-card:focus-visible {
  outline: 2px solid var(--md-sys-color-on-surface);
  outline-offset: 0;
}

.note-card.is-selected {
  border-color: var(--md-sys-color-on-surface);
  box-shadow: inset 0 0 0 2px var(--md-sys-color-on-surface);
}

.card-images {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  overflow: hidden;
  border-radius: calc(var(--keep-card-radius) - 1px) calc(var(--keep-card-radius) - 1px) 0 0;
}

.card-images.is-multi {
  grid-template-columns: 1fr 1fr;
}

.card-image-link,
.card-image-link img {
  display: block;
  width: 100%;
}

.card-image-link img {
  max-height: 320px;
  object-fit: cover;
  cursor: zoom-in;
}

.card-body {
  padding: 12px 16px 0;
  min-height: 46px;
}

.card-body:empty {
  display: none;
}

.card-body :deep(> :first-child) {
  padding-right: calc(var(--keep-control-size) - 4px);
}

.note-card:has(.card-images) .card-body :deep(> :first-child) {
  padding-right: 0;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--keep-control-size);
  height: var(--keep-control-size);
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background-color var(--md-sys-motion-duration-short) ease,
              color var(--md-sys-motion-duration-short) ease;
}

.action-btn:hover {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  color: var(--md-sys-color-on-surface);
}

.action-btn.active {
  color: var(--md-sys-color-on-surface);
}

/* Harmonious action icons on colored notes (Keep) */
.note-card.is-tinted .action-btn {
  color: color-mix(in srgb, var(--md-sys-color-on-surface) 72%, transparent);
}

.note-card.is-tinted .action-btn:hover,
.note-card.is-tinted .action-btn.active {
  color: var(--md-sys-color-on-surface);
}

.action-btn:disabled {
  cursor: wait;
}

/* Hover-revealed controls (Keep): pin, select check, toolbar. */
.card-pin-btn,
.card-select-btn,
.card-actions {
  opacity: 0;
  transition: opacity var(--md-sys-motion-duration-short) ease;
}

.note-card:hover :is(.card-pin-btn, .card-select-btn, .card-actions),
.note-card:focus-within :is(.card-pin-btn, .card-select-btn, .card-actions),
.note-card.has-menu-open :is(.card-pin-btn, .card-select-btn, .card-actions),
.card-select-btn.is-visible,
.note-card.is-selecting .card-select-btn {
  opacity: 1;
}

.card-pin-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
}

.card-pin-btn.active :deep(path) {
  fill: currentColor;
}

/* Pinned notes retain visible pin button at rest (Keep) */
.note-card.is-sticky .card-pin-btn {
  opacity: 1;
}

.note-card:has(.card-images) .card-pin-btn {
  background: color-mix(in srgb, var(--md-sys-color-surface) 75%, transparent);
  backdrop-filter: blur(4px);
}

.note-card:has(.card-images) .card-pin-btn:hover {
  background: var(--md-sys-color-surface);
}

.card-select-btn {
  position: absolute;
  top: -11px;
  left: -11px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-on-surface);
  color: var(--md-sys-color-surface);
  cursor: pointer;
  box-shadow: var(--keep-shadow-hover);
}

.card-select-btn .ui-icon {
  width: 16px;
  height: 16px;
  stroke-width: 2.5;
}

.card-select-btn:not(.is-selected) {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 60%, transparent);
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: var(--keep-control-size);
  margin: 4px 0;
  padding: 0 8px;
}

.action-btn .ui-icon {
  width: 20px;
  height: 20px;
}

.color-picker-wrapper {
  position: relative;
  display: inline-flex;
}

.color-palette-popover {
  position: fixed;
  background: var(--md-sys-color-surface-container);
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--keep-card-radius);
  box-shadow: var(--keep-shadow-raised);
  padding: 8px;
  display: grid;
  grid-template-columns: repeat(4, var(--keep-control-size));
  gap: 4px;
  z-index: 50;
}

.color-swatch-btn {
  width: var(--keep-control-size);
  height: var(--keep-control-size);
  border-radius: var(--md-sys-shape-corner-full);
  /* The hit area grows on touch screens; the color remains 28px. */
  border: calc((var(--keep-control-size) - 28px) / 2) solid transparent;
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

.color-swatch-btn.is-default {
  box-shadow: inset 0 0 0 2px var(--md-sys-color-outline-variant);
}

.color-swatch-btn:focus-visible {
  outline: 2px solid var(--md-sys-color-on-surface);
  outline-offset: -2px;
}

.color-swatch-btn[aria-disabled="true"] {
  cursor: wait;
}

.action-error {
  margin: 12px 16px 0;
  background-color: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0.5rem 0.75rem;
  font-size: var(--md-sys-typescale-body-small);
}

.card-body {
  font-size: var(--md-sys-typescale-body-medium);
  line-height: 1.43;
  letter-spacing: 0.0142em;
  color: var(--md-sys-color-on-surface);
  word-break: break-word;
  overflow-wrap: break-word;
}

.card-preview-hint {
  margin: 12px 16px 0;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-small);
}

/* Heading typography hierarchy (Keep) */
.card-body :deep(h1) {
  font-size: var(--md-sys-typescale-title-medium);
  font-weight: 500;
  line-height: 1.5;
  letter-spacing: 0.00625em;
  margin: 0;
}

.card-body :deep(h2) {
  font-size: 0.9375rem;
  font-weight: 500;
  line-height: 1.4;
  margin: 0;
}

.card-body :deep(h3),
.card-body :deep(h4),
.card-body :deep(h5),
.card-body :deep(h6) {
  font-size: 0.875rem;
  font-weight: 500;
  line-height: 1.4;
  margin: 0;
}

.card-body :deep(> * + *) {
  margin-top: 0.5rem;
}

.card-body :deep(ul),
.card-body :deep(ol) {
  padding-left: 1.25rem;
}

.card-body :deep(blockquote) {
  padding: 0.25rem 0.75rem;
  border-left: 3px solid var(--md-sys-color-outline);
  color: var(--md-sys-color-on-surface-variant);
  margin: 0.5rem 0;
  font-style: italic;
}

.card-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--md-sys-color-outline-variant);
  margin: 0.75rem 0;
}

.card-body :deep(:not(pre) > code) {
  font-family: var(--md-sys-typescale-font-mono);
  font-size: 0.85em;
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  padding: 0.15em 0.35em;
  border-radius: var(--md-sys-shape-corner-xs);
  border: 1px solid color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
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
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
  color: var(--md-sys-color-on-surface);
  border-radius: var(--md-sys-shape-corner-xs);
  padding: 0.5rem 0.75rem;
  font-size: 0.8125rem;
  font-family: var(--md-sys-typescale-font-mono);
  line-height: 1.45;
  border: 1px solid color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
}

.card-body :deep(table) {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  display: block;
  border-collapse: collapse;
  border-spacing: 0;
  margin: 0.5rem 0;
  font-size: var(--md-sys-typescale-body-small);
}

.card-body :deep(th),
.card-body :deep(td) {
  padding: 6px 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
  text-align: left;
}

.card-body :deep(th) {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
  font-weight: 600;
}

.card-body :deep(tr:nth-child(even) td) {
  background-color: color-mix(in srgb, var(--md-sys-color-on-surface) 3%, transparent);
}

.card-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 16px 0;
}

.attachment-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-body-small);
  text-decoration: none;
}

.attachment-link:not(.card-image-link) {
  padding: 4px 8px;
  border-radius: var(--md-sys-shape-corner-xs);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 6%, transparent);
  border: 1px solid color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.attachment-link:not(.card-image-link):hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 12%, transparent);
}

.attachment-link:not(.card-image-link):hover .attachment-name {
  text-decoration: underline;
}

.attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-size {
  flex-shrink: 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 0.75rem;
}

.card-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 0;
}

.card-footer:last-child {
  padding-bottom: 12px;
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
  color: var(--md-sys-color-on-surface);
}

.status-chip .ui-icon {
  width: 14px;
  height: 14px;
}

.note-time {
  font-size: var(--md-sys-typescale-label-medium);
  color: var(--md-sys-color-on-surface-variant);
}

.card-body:last-child {
  padding-bottom: 12px;
}

/* Links read as text; #tags read as Keep label chips. */
.card-body :deep(a) {
  color: inherit;
  text-underline-offset: 2px;
}

.card-body :deep(a[href^="#search?#"]) {
  display: inline-block;
  vertical-align: baseline;
  margin: 1px 2px;
  padding: 0 6px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
  font-size: var(--md-sys-typescale-label-medium);
  line-height: 1.5;
  text-decoration: none;
  white-space: nowrap;
}

.card-body :deep(a[href^="#search?#"]):hover {
  background: color-mix(in srgb, var(--md-sys-color-on-surface) 14%, transparent);
}

/* Task List Interactive Checkbox Styles */
.card-body :deep(ul.task-list),
:deep(.task-list) {
  list-style: none;
  padding-left: 0;
  margin: 0.25rem 0;
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
  width: 1.125rem;
  height: 1.125rem;
  margin-right: 0.5rem;
  margin-top: 0.15rem;
  cursor: pointer;
  accent-color: var(--md-sys-color-primary, var(--md-sys-color-on-surface));
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
  .card-actions,
  .card-pin-btn {
    opacity: 1;
  }
}

@media (pointer: coarse) {
  .card-actions { gap: 0; padding: 0 4px; }
}
</style>
