<template>
  <div class="public-stream-view">
    <header class="stream-header">
      <h1>{{ profile ? (profile.displayName || profile.username) + "'s Notes" : 'Public Stream' }}</h1>
    </header>

    <div v-if="loading" class="status-indicator">Loading stream...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>

    <main class="stream-content" v-else>
      <div v-if="things.length" class="notes-list">
        <article v-for="thing in things" :key="thing._id" class="note-card">
          <div class="note-body" v-html="renderedContent(thing.content)"></div>
          <footer class="note-meta">
            <span class="note-date">{{ formatDate(thing.createdAt) }}</span>
            <span v-for="tag in thing.tags" :key="tag" class="tag-badge">#{{ tag }}</span>
          </footer>
        </article>
      </div>
      <div v-else class="empty-state">
        <p>No public notes available.</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { api, type Thing, type PublicUserProfile } from '../api/client';
import { renderMarkdown } from '../utils/markdown';

const route = useRoute();
const userId = String(route.params.userId);

const profile = ref<PublicUserProfile | null>(null);
const things = ref<Thing[]>([]);
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
    const userRes = await api.public.userProfile(userId);
    profile.value = userRes.user;
    const thingsRes = await api.public.listThings(userId);
    things.value = thingsRes.things;
  } catch (err: any) {
    error.value = err.message || 'Failed to load public stream';
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.public-stream-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
.stream-header {
  border-bottom: 2px solid #3182ce;
  padding-bottom: 1rem;
}
.note-card {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  margin-top: 1rem;
  background: #fff;
}
.note-meta {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  color: #718096;
  display: flex;
  gap: 0.5rem;
}
.tag-badge {
  background: #edf2f7;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  color: #4a5568;
}
.error-banner {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 0.75rem;
  border-radius: 4px;
  margin-top: 1rem;
}
.empty-state {
  text-align: center;
  color: #a0aec0;
  margin-top: 3rem;
}
</style>
