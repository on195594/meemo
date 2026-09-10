<template>
  <div class="notes-view">
    <header class="notes-header">
      <h1>Meemo</h1>
      <div v-if="loading" class="status-indicator">Loading...</div>
      <div v-else-if="user" class="user-greeting">
        Welcome, {{ user.displayName || user.username }}
      </div>
    </header>

    <main class="notes-content">
      <div v-if="error" class="error-banner">
        {{ error }}
      </div>

      <div class="notes-list" v-if="things.length">
        <article v-for="thing in things" :key="thing._id" class="note-card">
          <div class="note-body" v-html="renderedContent(thing.content)"></div>
          <footer class="note-meta">
            <span class="note-date">{{ formatDate(thing.createdAt) }}</span>
            <span v-for="tag in thing.tags" :key="tag" class="tag-badge">#{{ tag }}</span>
          </footer>
        </article>
      </div>

      <div v-else-if="!loading" class="empty-state">
        <p>No notes found. Create your first note!</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api, type Thing, type UserProfile } from '../api/client';
import { renderMarkdown } from '../utils/markdown';

const user = ref<UserProfile | null>(null);
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
    const profileRes = await api.auth.profile();
    user.value = profileRes.user;
    const thingsRes = await api.things.list();
    things.value = thingsRes.things;
  } catch (err: any) {
    if (err.status !== 401) {
      error.value = err.message || 'Failed to load notes';
    }
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.notes-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 1.5rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
}
.notes-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #eee;
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
