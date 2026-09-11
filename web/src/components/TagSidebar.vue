<template>
  <aside class="tag-sidebar" aria-label="Navigation and tags filter">
    <!-- Views Navigation (Notes & Public Stream) -->
    <nav class="sidebar-nav" aria-label="Views">
      <router-link
        to="/"
        class="sidebar-nav-item"
        :class="{ active: $route.path === '/' && !selectedTag }"
        title="All Notes"
      >
        <span class="nav-icon">📝</span>
        <span class="nav-text">Notes</span>
      </router-link>

      <router-link
        v-if="user"
        :to="`/public/${user.username}`"
        class="sidebar-nav-item"
        :class="{ active: $route.path === `/public/${user.username}` }"
        title="My Public Stream"
      >
        <span class="nav-icon">🌐</span>
        <span class="nav-text">Public Stream</span>
      </router-link>
    </nav>

    <div class="sidebar-divider"></div>

    <div class="sidebar-header">
      <h3 class="sidebar-title">Tags</h3>
      <button
        v-if="selectedTag"
        type="button"
        class="clear-tag-btn"
        @click="$emit('clearTag')"
        title="Clear selected tag"
      >
        Clear
      </button>
    </div>

    <div v-if="tags && tags.length > 0" class="tag-list">
      <button
        v-for="tag in tags"
        :key="tag.name"
        type="button"
        class="tag-item"
        :class="{ active: selectedTag === tag.name }"
        @click="$emit('selectTag', tag.name)"
        :title="`Filter by #${tag.name}`"
      >
        <span class="tag-name">#{{ tag.name }}</span>
        <span class="tag-count">{{ tag.usage }}</span>
      </button>
    </div>

    <div v-else class="no-tags">
      <span>No tags yet</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { useAuth } from '../composables/useAuth';
import type { Tag } from '../api/client';

const { user } = useAuth();

defineProps<{
  tags: Tag[];
  selectedTag?: string | null;
}>();

defineEmits<{
  (e: 'selectTag', tag: string): void;
  (e: 'clearTag'): void;
}>();
</script>

<style scoped>
.tag-sidebar {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.sidebar-nav-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.65rem;
  border-radius: 6px;
  text-decoration: none;
  font-size: 0.875rem;
  font-weight: 500;
  color: #4a5568;
  transition: all 0.15s ease;
}

.sidebar-nav-item:hover {
  background-color: #f7fafc;
  color: #2b6cb0;
}

.sidebar-nav-item.active {
  background-color: #ebf8ff;
  color: #2b6cb0;
  font-weight: 600;
}

.sidebar-nav-item .nav-icon {
  font-size: 1rem;
  line-height: 1;
}

.sidebar-divider {
  height: 1px;
  background-color: #edf2f7;
  margin: 0.75rem 0;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #edf2f7;
}

.sidebar-title {
  font-size: 0.95rem;
  font-weight: 600;
  color: #2d3748;
  margin: 0;
}

.clear-tag-btn {
  background: none;
  border: none;
  font-size: 0.75rem;
  color: #3182ce;
  cursor: pointer;
  padding: 0.1rem 0.3rem;
  border-radius: 3px;
}

.clear-tag-btn:hover {
  text-decoration: underline;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tag-item {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  background-color: #f7fafc;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  padding: 0.2rem 0.6rem;
  font-size: 0.8rem;
  color: #4a5568;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-item:hover {
  border-color: #3182ce;
  color: #2b6cb0;
}

.tag-item.active {
  background-color: #ebf8ff;
  border-color: #3182ce;
  color: #2b6cb0;
  font-weight: 600;
}

.tag-name {
  white-space: nowrap;
}

.tag-count {
  font-size: 0.7rem;
  background-color: #e2e8f0;
  color: #4a5568;
  padding: 0.05rem 0.3rem;
  border-radius: 8px;
}

.tag-item.active .tag-count {
  background-color: #bee3f8;
  color: #2b6cb0;
}

.no-tags {
  font-size: 0.85rem;
  color: #a0aec0;
  text-align: center;
  padding: 0.5rem 0;
}
</style>
