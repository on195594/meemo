<template>
  <Transition name="batch-bar-slide">
    <aside v-if="count > 0" class="batch-action-bar" role="toolbar" aria-label="Batch actions">
      <div class="batch-bar-leading">
        <button
          type="button"
          class="batch-btn batch-close-btn"
          title="Clear selection (Esc)"
          aria-label="Clear selection"
          :disabled="isBatchMutating"
          @click="emit('clear')"
        >
          <UiIcon name="close" />
        </button>
        <span class="batch-count">{{ count }} selected</span>
        <button
          type="button"
          class="batch-text-btn"
          :disabled="isBatchMutating"
          @click="count === total ? emit('clear') : emit('selectAll')"
        >
          {{ count === total ? 'Deselect all' : 'Select all' }}
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
              @click="emit('color', c.key)"
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
          @click="emit('pin')"
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
          @click="emit('archive')"
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
          @click="emit('delete')"
        >
          <UiIcon name="trash" />
        </button>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { ref, nextTick, onUnmounted, watch } from 'vue';
import UiIcon from './UiIcon.vue';
import { NOTE_COLORS } from '../constants/noteColors';
import type { NoteColor } from '../api/client';

const props = defineProps<{ count: number; total: number; isBatchMutating: boolean; isArchived: boolean }>();
const emit = defineEmits<{
  (e: 'clear' | 'selectAll' | 'pin' | 'archive' | 'delete'): void;
  (e: 'color', color: NoteColor): void;
}>();

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
    event.stopPropagation();
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

watch(() => props.count, (count) => {
  if (count <= 0) closeBatchColorPicker(false);
});

onUnmounted(() => document.removeEventListener('pointerdown', handleOutsideBatchColorPicker));

defineExpose({ closeColorPicker: closeBatchColorPicker, showColorPicker: showBatchColorPicker });
</script>

<style scoped>
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
