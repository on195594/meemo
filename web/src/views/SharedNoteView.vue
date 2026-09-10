<template>
  <div class="shared-note-view">
    <div v-if="loading" class="status-indicator">Loading shared note...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>

    <article v-else-if="thing" class="note-card">
      <header class="note-header">
        <span class="note-date">{{ formatDate(thing.createdAt) }}</span>
      </header>
      <div class="note-body" v-html="renderedContent(thing.content)"></div>
      <footer class="note-footer" v-if="thing.tags.length">
        <span v-for="tag in thing.tags" :key="tag" class="tag-badge">#{{ tag }}</span>
      </footer>
    </article>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, type Thing } from '../api/client';
import { renderMarkdown } from '../utils/markdown';

const route = useRoute();
const thingId = String(route.params.thingId);

const thing = ref<Thing | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

function renderedContent(content: string) {
  return renderMarkdown(content);
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

onMounted(async () => {
  try {
    // Attempt fetching note through public API
    const res = await api.public.getThing('shared', thingId);
    thing.value = res.thing;
  } catch (err: any) {
    error.value = err.message || 'Note is private or does not exist';
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.shared-note-view {
  max-width: 700px;
  margin: 2rem auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
.note-card {
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  padding: 1.5rem;
  background: #fff;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
.note-header {
  margin-bottom: 1rem;
  color: #718096;
  font-size: 0.9rem;
}
.note-footer {
  margin-top: 1.5rem;
  display: flex;
  gap: 0.5rem;
}
.tag-badge {
  background: #edf2f7;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  color: #4a5568;
}
.error-banner {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 1rem;
  border-radius: 6px;
  text-align: center;
}
</style>
