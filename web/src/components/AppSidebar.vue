<template>
  <div class="app-sidebar-slot" :class="{ expanded, 'mobile-open': mobileOpen }">
    <div v-if="mobileOpen" class="sidebar-scrim" @click="$emit('close')"></div>
    <nav ref="navRef" class="app-sidebar" aria-label="Notes navigation" @keydown.esc="$emit('close')" @keydown.tab="trapTab">
      <button
        v-for="item in items"
        :key="item.key"
        type="button"
        class="sidebar-item"
        :class="{ active: item.active }"
        :aria-current="item.active ? 'page' : undefined"
        :title="item.label"
        @click="navigate(item.query)"
      >
        <UiIcon :name="item.icon" />
        <span class="sidebar-label">{{ item.label }}</span>
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';
import UiIcon from './UiIcon.vue';

const props = defineProps<{ expanded: boolean; mobileOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const route = useRoute();
const router = useRouter();

const inArchive = computed(() => route.query.archived === '1' || route.query.archived === 'true');
const inTrash = computed(() => route.query.deleted === '1' || route.query.deleted === 'true');

type Item = { key: string; label: string; icon: 'bulb' | 'archive' | 'trash'; query: LocationQueryRaw; active: boolean };

const items = computed<Item[]>(() => [
  { key: 'notes', label: 'Notes', icon: 'bulb', query: {}, active: !inArchive.value && !inTrash.value },
  { key: 'archive', label: 'Archive', icon: 'archive', query: { archived: 'true' }, active: inArchive.value },
  { key: 'trash', label: 'Trash', icon: 'trash', query: { deleted: 'true' }, active: inTrash.value },
]);

function navigate(query: LocationQueryRaw) {
  if (route.path !== '/') router.push({ path: '/', query });
  else router.replace({ query });
  emit('close');
}

// Mobile drawer acts as a modal: focus moves in on open and Tab stays inside.
const navRef = ref<HTMLElement | null>(null);
function drawerItems() {
  return Array.from(navRef.value?.querySelectorAll<HTMLElement>('.sidebar-item') || []);
}
watch(() => props.mobileOpen, (open) => {
  if (!open) return;
  nextTick(() => (navRef.value?.querySelector<HTMLElement>('.sidebar-item.active') || drawerItems()[0])?.focus());
});
function trapTab(event: KeyboardEvent) {
  if (!props.mobileOpen) return;
  const items = drawerItems();
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
</script>

<style scoped>
.app-sidebar-slot {
  position: relative;
  flex: 0 0 80px;
  width: 80px;
  z-index: 50;
  transition: flex-basis var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              width var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.app-sidebar-slot.expanded {
  flex-basis: 280px;
  width: 280px;
}

.app-sidebar {
  position: sticky;
  top: 64px;
  width: 80px;
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
  background: var(--md-sys-color-surface);
  border-radius: 0 var(--md-sys-shape-corner-lg) var(--md-sys-shape-corner-lg) 0;
  transition: width var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
              box-shadow var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
}

.app-sidebar-slot.expanded .app-sidebar {
  width: 280px;
}

/* Collapsed rail peeks open over the content on hover, like Keep. */
@media (hover: hover) and (min-width: 768px) {
  .app-sidebar-slot:not(.expanded) .app-sidebar:hover,
  .app-sidebar-slot:not(.expanded) .app-sidebar:focus-within {
    width: 280px;
    box-shadow: var(--keep-shadow-raised);
  }
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 0;
  width: 100%;
  height: 48px;
  padding: 0 0 0 24px;
  border: none;
  border-radius: 0 var(--md-sys-shape-corner-full) var(--md-sys-shape-corner-full) 0;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  letter-spacing: 0.01785em;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}

.sidebar-item .ui-icon {
  width: 24px;
  height: 24px;
  color: var(--md-sys-color-on-surface-variant);
}

.sidebar-label {
  margin-left: 32px;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sidebar-item:hover {
  background: var(--md-sys-state-hover);
}

.sidebar-item.active {
  background: var(--keep-nav-active);
  color: var(--keep-on-nav-active);
}

.sidebar-item.active .ui-icon {
  color: var(--keep-on-nav-active);
}

/* Collapsed rail: active item becomes a circle around the icon. */
.app-sidebar-slot:not(.expanded) .app-sidebar:not(:hover):not(:focus-within) .sidebar-item {
  width: 48px;
  margin-left: 12px;
  padding-left: 12px;
  border-radius: var(--md-sys-shape-corner-full);
}

.sidebar-item:focus-visible {
  outline-offset: -2px;
}

.sidebar-scrim {
  display: none;
}

@media (max-width: 767px) {
  /* z-index on a flex item creates a stacking context; drop it so the drawer can cover the header. */
  .app-sidebar-slot,
  .app-sidebar-slot.expanded {
    position: static;
    z-index: auto;
    flex: 0 0 0;
    width: 0;
  }

  .app-sidebar {
    position: fixed;
    top: 0;
    left: 0;
    bottom: 0;
    width: 280px;
    max-height: none;
    z-index: 300;
    padding-top: 16px;
    background: var(--md-sys-color-surface);
    box-shadow: var(--keep-shadow-dialog);
    transform: translateX(-105%);
    visibility: hidden;
    transition: transform var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing),
                visibility 0s linear var(--md-sys-motion-duration-medium);
  }

  .app-sidebar-slot.mobile-open .app-sidebar {
    transform: none;
    visibility: visible;
    transition: transform var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing);
  }

  .app-sidebar-slot:not(.expanded) .app-sidebar:not(:hover):not(:focus-within) .sidebar-item {
    width: 100%;
    margin-left: 0;
    padding-left: 24px;
    border-radius: 0 var(--md-sys-shape-corner-full) var(--md-sys-shape-corner-full) 0;
  }

  .sidebar-scrim {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 299;
    background: var(--md-sys-color-scrim);
  }
}
</style>
