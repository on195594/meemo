<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path :d="paths[name]" />
  </svg>
</template>

<script setup lang="ts">
const paths = {
  search: 'M21 21l-4.5-4.5 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 1.5 1.5 0 0 1 0-3h3a5 5 0 0 0 5-5c0-3.3-4-6-9-6 M7 9h.01 M10 6h.01 M15 7h.01 M6 13h.01',
  pin: 'M9 3h6 M10 3v5l-3 4v3h10v-3l-3-4V3 M12 15v6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c4 4 4 14 0 18-4-4-4-14 0-18',
  archive: 'M3 3h18v4H3z M5 7v14h14V7 M10 11h4',
  edit: 'M15 5l4 4 M4 20l1-5L16 4a2.8 2.8 0 0 1 4 4L9 19z',
  trash: 'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
  attach: 'M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9 M6 14l8-8',
  restore: 'M3 10a9 9 0 1 1 2 8 M3 4v6h6',
  expand: 'M14 4h6v6 M20 4l-7 7 M10 20H4v-6 M4 20l7-7',
  sun: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1.5 1.5 M17.5 17.5L19 19 M5 19l1.5-1.5 M17.5 6.5L19 5',
  moon: 'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10',
  system: 'M3 4h18v13H3z M8 21h8 M12 17v4',
  note: 'M5 3h10l4 4v14H5z M15 3v5h4 M9 12h6 M9 16h6',
  lock: 'M5 10h14v11H5z M8 10V7a4 4 0 0 1 8 0v3 M12 14v3',
  close: 'M6 6l12 12 M6 18L18 6',
  menu: 'M4 6h16 M4 12h16 M4 18h16',
  grid: 'M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z',
  list: 'M4 5h16v6H4z M4 13h16v6H4z',
  checkbox: 'M4 4h16v16H4z M8 12l3 3 5-6',
  image: 'M4 4h16v16H4z M4 16l5-5 4 4 2-2 5 5 M15.5 8.5h.01',
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3',
  label: 'M3 12V4h8l10 10-7 7z M7.5 7.5h.01',
  check: 'M5 12l5 5 9-10',
};
defineProps<{ name: keyof typeof paths }>();
</script>

<style scoped>
.ui-icon {
  width: 1.125rem;
  height: 1.125rem;
  flex-shrink: 0;
  vertical-align: middle;
}
</style>
