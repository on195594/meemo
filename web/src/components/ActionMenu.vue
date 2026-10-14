<template>
  <div class="action-menu-wrapper" @click.stop>
    <button
      v-bind="$attrs"
      ref="triggerRef"
      type="button"
      class="action-menu-trigger"
      :aria-label="label"
      :title="label"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      :disabled="disabled"
      @click="open = !open"
      @keydown.down.prevent.stop="openAt(false)"
      @keydown.up.prevent.stop="openAt(true)"
    ><slot name="trigger" /></button>
    <Teleport to="body">
      <div
        v-if="open"
        :id="menuId"
        ref="panelRef"
        class="action-menu-panel"
        role="menu"
        :aria-label="label"
        tabindex="-1"
        @keydown="handleKeydown"
        @click.stop="handleItemClick"
      ><slot /></div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { getCurrentInstance, nextTick, onUnmounted, ref, watch } from 'vue';
import { usePopoverPosition } from '../composables/usePopoverPosition';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ label: string; disabled?: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const triggerRef = ref<HTMLButtonElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
const menuId = `action-menu-${getCurrentInstance()!.uid}`;
let startAtEnd = false;
usePopoverPosition(triggerRef, panelRef, open);

function items() {
  return Array.from(panelRef.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') || []);
}

function close(returnFocus = true) {
  open.value = false;
  if (returnFocus) triggerRef.value?.focus();
}

function openAt(last: boolean) {
  if (props.disabled) return;
  startAtEnd = last;
  open.value = true;
}

function handleKeydown(event: KeyboardEvent) {
  const choices = items();
  const index = choices.indexOf(document.activeElement as HTMLElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
  } else if (event.key === 'Tab') {
    // Let native Tab continue from the trigger, not a removed teleported item.
    triggerRef.value?.focus();
    close(false);
  } else if (choices.length && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length;
    choices[next].focus();
  } else if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
    const choice = [...choices.slice(index + 1), ...choices.slice(0, index + 1)]
      .find(item => (item.getAttribute('aria-label') || item.textContent || '').trim().toLowerCase().startsWith(event.key.toLowerCase()));
    if (choice) {
      event.preventDefault();
      event.stopPropagation();
      choice.focus();
    }
  }
}

function handleItemClick(event: MouseEvent) {
  if ((event.target as Element).closest('[role="menuitem"]')) close();
}

function handleOutside(event: Event) {
  const target = event.target as Node;
  if (!triggerRef.value?.contains(target) && !panelRef.value?.contains(target)) close(false);
}

function cleanup() {
  document.removeEventListener('pointerdown', handleOutside);
  document.removeEventListener('focusin', handleOutside);
}

watch(open, async (visible) => {
  cleanup();
  if (!visible) return;
  await nextTick();
  if (!open.value) return;
  const choices = items();
  (choices[startAtEnd ? choices.length - 1 : 0] || panelRef.value)?.focus();
  startAtEnd = false;
  document.addEventListener('pointerdown', handleOutside);
  document.addEventListener('focusin', handleOutside);
});
watch(() => props.disabled, (disabled) => { if (disabled) close(false); });
onUnmounted(cleanup);
defineExpose({ close });
</script>

<style scoped>
.action-menu-wrapper {
  display: inline-flex;
  flex-shrink: 0;
}
.action-menu-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--keep-control-size);
  height: var(--keep-control-size);
  padding: 0;
  border: 0;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.action-menu-trigger:hover:not(:disabled),
.action-menu-trigger[aria-expanded="true"] {
  background: var(--md-sys-state-hover);
  color: var(--md-sys-color-on-surface);
}
.action-menu-trigger:active:not(:disabled) { background: var(--md-sys-state-pressed); }
.action-menu-trigger:disabled { cursor: wait; opacity: 0.5; }
.action-menu-trigger :deep(.ui-icon) { width: 20px; height: 20px; }
.action-menu-panel {
  position: fixed;
  min-width: min(200px, calc(100vw - 16px));
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
  padding: 6px 0;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--keep-card-radius);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--keep-shadow-raised);
  z-index: 1100;
}
.action-menu-panel :deep([role="menuitem"]) {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: var(--keep-control-size);
  padding: 8px 16px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  text-decoration: none;
  font-size: var(--md-sys-typescale-label-large);
  cursor: pointer;
}
.action-menu-panel :deep([role="menuitem"]:hover),
.action-menu-panel :deep([role="menuitem"]:focus-visible) { background: var(--md-sys-state-hover); }
.action-menu-panel :deep([role="menuitem"]:focus-visible) { outline-offset: -3px; }
.action-menu-panel :deep([role="menuitem"]:active) { background: var(--md-sys-state-pressed); }
.action-menu-panel :deep(.menu-danger) { color: var(--md-sys-color-error); }
.action-menu-panel :deep(.ui-icon) { width: 18px; height: 18px; }
</style>
