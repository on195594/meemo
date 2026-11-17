<template>
  <div
    v-if="open"
    ref="paletteRef"
    :id="id"
    class="color-palette-popover"
    role="group"
    :aria-label="label"
  >
    <button
      v-for="(c, index) in NOTE_COLORS"
      :key="c.key"
      type="button"
      class="color-swatch-btn"
      :class="{ active: color === c.key, 'is-default': c.key === 'default' }"
      :style="{ backgroundColor: 'var(--note-color-' + c.key + ')' }"
      :title="c.name"
      :aria-label="c.name"
      :aria-pressed="color === c.key"
      :aria-disabled="disabled || undefined"
      :tabindex="focusedIndex === index ? 0 : -1"
      @click="!disabled && emit('select', c.key)"
      @keydown="handleKeydown($event, index)"
    ></button>
  </div>
</template>

<script setup lang="ts">
import { ref, toRef, watch, nextTick, onUnmounted } from 'vue';
import type { NoteColor } from '../api/client';
import { NOTE_COLORS } from '../constants/noteColors';
import { usePopoverPosition } from '../composables/usePopoverPosition';

const props = withDefaults(defineProps<{
  open: boolean;
  id: string;
  color: NoteColor;
  label: string;
  anchor: HTMLElement | null;
  wrapper: HTMLElement | null;
  disabled?: boolean;
  modal?: boolean;
  waitCursor?: boolean;
}>(), { disabled: undefined });
const emit = defineEmits<{
  (e: 'select', color: NoteColor): void;
  (e: 'navigate', color: NoteColor): void;
  (e: 'close', returnFocus?: boolean): void;
}>();
const paletteRef = ref<HTMLElement | null>(null);
const focusedIndex = ref(0);
usePopoverPosition(toRef(props, 'anchor'), paletteRef, toRef(props, 'open'));

function focusColor(index: number) {
  focusedIndex.value = index;
  nextTick(() => paletteRef.value?.querySelectorAll<HTMLButtonElement>('.color-swatch-btn')[index]?.focus());
}

function handleOutside(event: Event) {
  const target = event.target as Node;
  if (props.open && !props.wrapper?.contains(target) && !paletteRef.value?.contains(target)) emit('close');
}
function cleanup() {
  document.removeEventListener('pointerdown', handleOutside);
  document.removeEventListener('focusin', handleOutside);
}
watch(() => props.open, (open) => {
  cleanup();
  if (!open) return;
  document.addEventListener('pointerdown', handleOutside);
  document.addEventListener('focusin', handleOutside);
  const selected = NOTE_COLORS.findIndex(color => color.key === props.color);
  focusColor(selected < 0 ? 0 : selected);
}, { immediate: true });
onUnmounted(cleanup);

function handleKeydown(event: KeyboardEvent, index: number) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close', true);
    return;
  }
  if (props.modal && event.key === 'Tab') {
    props.anchor?.focus();
    emit('close');
    return;
  }
  const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 };
  if (offsets[event.key] === undefined && event.key !== 'Home' && event.key !== 'End') return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? NOTE_COLORS.length - 1
    : (index + offsets[event.key] + NOTE_COLORS.length) % NOTE_COLORS.length;
  emit('navigate', NOTE_COLORS[nextIndex].key);
  focusColor(nextIndex);
}
</script>

<style scoped>
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
  z-index: v-bind('modal ? 1050 : 50');
}

.color-swatch-btn {
  width: var(--keep-control-size);
  height: var(--keep-control-size);
  border-radius: var(--md-sys-shape-corner-full);
  /* The hit area grows on touch screens; the color remains 28px. */
  border: calc((var(--keep-control-size) - 28px) / 2) solid transparent;
  background-clip: content-box;
  cursor: v-bind('waitCursor && disabled ? "wait" : "pointer"');
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



</style>
