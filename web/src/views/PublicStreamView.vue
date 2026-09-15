<template>
  <div class="public-stream-view">
    <header class="stream-header">
      <h1>{{ profile ? (profile.displayName || profile.username) + "'s Public Notes" : 'Public Stream' }}</h1>
    </header>

    <div v-if="loading" class="status-indicator">Loading stream...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>

    <main class="stream-content" v-else>
      <div v-if="things.length" class="notes-list">
        <NoteCard
          v-for="thing in things"
          :key="thing._id"
          :thing="thing"
          :can-edit="false"
          @wikilink-click="handleWikilinkClick"
        />
      </div>
      <div v-else class="empty-state">
        <p>No public notes available.</p>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Thing, type PublicUserProfile } from '../api/client';
import NoteCard from '../components/NoteCard.vue';

const route = useRoute();
const router = useRouter();
const userId = String(route.params.userId);

function handleWikilinkClick(target: string) {
  router.push({ path: '/', query: { q: target } });
}

const profile = ref<PublicUserProfile | null>(null);
const things = ref<Thing[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const userRes = await api.public.userProfile(userId);
    profile.value = userRes.user;
    const thingsRes = await api.public.listThings(userId);
    things.value = thingsRes.things || [];
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
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
}
.stream-header h1 {
  font-size: 1.5rem;
  color: #2d3748;
}
.status-indicator {
  text-align: center;
  color: #718096;
  margin-top: 2rem;
}
.error-banner {
  background: #fed7d7;
  color: #9b2c2c;
  padding: 0.75rem;
  border-radius: 4px;
}
.empty-state {
  text-align: center;
  color: #a0aec0;
  margin-top: 3rem;
}
</style>
