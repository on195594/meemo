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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.status-indicator {
  text-align: center;
  color: var(--md-sys-color-on-surface-variant, #718096);
}
.error-banner {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 0.75rem;
  border-radius: 4px;
}
.back-link {
  display: inline-block;
  margin-bottom: 1rem;
  color: var(--md-sys-color-primary, #2563eb);
}
</style>
