<template>
  <div class="notes-view">
    <header class="notes-header">
      <h1>Meemo</h1>
      <div v-if="authLoading || thingsLoading" class="status-indicator">Loading...</div>
      <div v-else-if="isAuthenticated && user" class="user-greeting">
        Welcome, {{ user.displayName || user.username }}
      </div>
    </header>

    <main class="notes-content">
      <div v-if="error" class="error-banner" role="alert">
        {{ error }}
      </div>

      <!-- Authenticated Content -->
      <template v-if="isAuthenticated">
        <div class="notes-list" v-if="things.length">
          <article v-for="thing in things" :key="thing._id" class="note-card">
            <div class="note-body" v-html="renderedContent(thing.content)"></div>
            <footer class="note-meta">
              <span class="note-date">{{ formatDate(thing.createdAt) }}</span>
              <span v-for="tag in thing.tags" :key="tag" class="tag-badge">#{{ tag }}</span>
            </footer>
          </article>
        </div>

        <div v-else-if="!thingsLoading" class="empty-state">
          <p>No notes found. Create your first note!</p>
        </div>
      </template>

      <!-- Unauthenticated First User State -->
      <div v-else-if="!authLoading && isFirstUser" class="auth-hero first-user-hero">
        <div class="hero-icon">🚀</div>
        <h2>Welcome to Meemo</h2>
        <p>No user account exists yet. Create your administrator account to start writing and organizing your thoughts.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('register')">
          Create Administrator Account
        </button>
      </div>

      <!-- Unauthenticated Regular State -->
      <div v-else-if="!authLoading" class="auth-hero login-hero">
        <div class="hero-icon">🔒</div>
        <h2>Sign In to Meemo</h2>
        <p>Log in with your credentials to access your notes, attachments, and settings.</p>
        <button type="button" class="hero-btn primary" @click="triggerAuthModal('login')">
          Log In
        </button>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, inject } from 'vue';
import { api, type Thing } from '../api/client';
import { useAuth } from '../composables/useAuth';
import { renderMarkdown } from '../utils/markdown';

const { user, isAuthenticated, isLoading: authLoading, isFirstUser } = useAuth();
const openAuthModal = inject<((tab?: 'login' | 'register') => void) | undefined>('openAuthModal', undefined);

const things = ref<Thing[]>([]);
const thingsLoading = ref(false);
const error = ref<string | null>(null);

function renderedContent(content: string) {
  return renderMarkdown(content);
}

function formatDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString();
}

function triggerAuthModal(tab: 'login' | 'register') {
  if (openAuthModal) {
    openAuthModal(tab);
  }
}

async function loadNotes() {
  if (!isAuthenticated.value) {
    things.value = [];
    return;
  }

  thingsLoading.value = true;
  error.value = null;
  try {
    const thingsRes = await api.things.list();
    things.value = thingsRes.things || [];
  } catch (err: any) {
    if (err.status !== 401) {
      error.value = err.message || 'Failed to load notes';
    }
  } finally {
    thingsLoading.value = false;
  }
}

watch(isAuthenticated, (authenticated) => {
  if (authenticated) {
    loadNotes();
  } else {
    things.value = [];
  }
});

onMounted(() => {
  if (isAuthenticated.value) {
    loadNotes();
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

.status-indicator {
  font-size: 0.9rem;
  color: #718096;
}

.user-greeting {
  font-size: 0.95rem;
  color: #4a5568;
  font-weight: 500;
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

.auth-hero {
  text-align: center;
  margin-top: 3rem;
  padding: 2.5rem 1.5rem;
  background: #ffffff;
  border-radius: 12px;
  border: 1px solid #e2e8f0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
}

.hero-icon {
  font-size: 2.5rem;
}

.auth-hero h2 {
  font-size: 1.5rem;
  color: #1a202c;
  margin: 0;
}

.auth-hero p {
  color: #4a5568;
  max-width: 480px;
  font-size: 1rem;
}

.hero-btn {
  padding: 0.65rem 1.5rem;
  border-radius: 6px;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
  margin-top: 0.5rem;
}

.hero-btn.primary {
  background-color: #2b6cb0;
  color: #ffffff;
}

.hero-btn.primary:hover {
  background-color: #2c5282;
}
</style>
