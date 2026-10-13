<template>
  <div class="private-note-view">
    <div v-if="loading" class="status-indicator">Loading note...</div>
    <div v-else-if="error" class="error-banner" role="alert">{{ error }}</div>

    <main v-else-if="thing" class="private-note-content">
      <router-link to="/" class="back-link">← Back to notes</router-link>
      <NoteCard
        :thing="thing"
        :can-edit="false"
        @wikilink-click="handleWikilinkClick"
      />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Thing } from '../api/client';
import NoteCard from '../components/NoteCard.vue';

const route = useRoute();
const router = useRouter();
const thing = ref<Thing | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

function handleWikilinkClick(target: string) {
  router.push({ path: '/', query: { q: target } });
}

async function loadThing(id: string): Promise<void> {
  loading.value = true;
  error.value = null;
  thing.value = null;
  try {
    const res = await api.things.get(id);
    thing.value = res.thing;
  } catch (err: any) {
    error.value = err.message || 'Note is private or does not exist';
  } finally {
    loading.value = false;
  }
}

watch(() => String(route.params.thingId), loadThing, { immediate: true });
</script>

<style scoped>
.private-note-view {
  max-width: 700px;
  margin: 2rem auto;
  padding: 1.5rem;
}
.status-indicator {
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-medium);
  margin-top: 2rem;
}
.error-banner {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  padding: 0.75rem 1rem;
  border-radius: var(--md-sys-shape-corner-md);
  font-size: var(--md-sys-typescale-body-medium);
}
.back-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  margin-bottom: 1rem;
  padding: 0.25rem 0.75rem 0.25rem 0.5rem;
  border-radius: var(--md-sys-shape-corner-full);
  color: var(--md-sys-color-primary);
  font-size: var(--md-sys-typescale-label-large);
  font-weight: 500;
  text-decoration: none;
  transition: background-color var(--md-sys-motion-duration-short) ease;
}
.back-link:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}
</style>
