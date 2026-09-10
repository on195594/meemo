<template>
  <article class="note-card" :class="{ 'is-sticky': thing.sticky, 'is-archived': thing.archived }">
    <header class="card-header">
      <div class="header-meta">
        <time :datetime="isoDate" :title="fullDate" class="note-time">
          {{ relativeDate }}
        </time>
        <span v-if="thing.sticky" class="badge badge-sticky" title="Pinned to top">
          📌 Pinned
        </span>
        <span v-if="thing.public" class="badge badge-public" title="Visible on public stream">
          🌐 Public
        </span>
        <span v-if="thing.shared" class="badge badge-shared" title="Directly shared">
          🔗 Shared
        </span>
        <span v-if="thing.archived" class="badge badge-archived" title="Archived note">
          📦 Archived
        </span>
      </div>
    </header>

    <!-- Markdown Content Body -->
    <div class="card-body markdown-body" v-html="renderedBody"></div>

    <!-- Attachments Display -->
    <div v-if="thing.attachments && thing.attachments.length > 0" class="card-attachments">
      <div
        v-for="att in thing.attachments"
        :key="att.identifier"
        class="attachment-item"
      >
        <a
          :href="attachmentUrl(att)"
          target="_blank"
          rel="noopener"
          class="attachment-link"
        >
          <span class="attachment-icon">{{ isImageAttachment(att) ? '🖼️' : '📎' }}</span>
          <span class="attachment-name">{{ att.fileName || att.identifier }}</span>
          <span v-if="att.size" class="attachment-size">({{ formatFileSize(att.size) }})</span>
        </a>
      </div>
    </div>

    <!-- Tags Footer -->
    <footer v-if="thing.tags && thing.tags.length > 0" class="card-footer">
      <div class="tags-container">
        <button
          v-for="tag in thing.tags"
          :key="tag"
          type="button"
          class="tag-pill"
          @click="$emit('tagClick', tag)"
          :title="`Filter by #${tag}`"
        >
          #{{ tag }}
        </button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Thing, AttachmentDescriptor } from '../api/client';
import { renderMarkdown } from '../utils/markdown';

const props = defineProps<{
  thing: Thing;
}>();

defineEmits<{
  (e: 'tagClick', tag: string): void;
}>();

const dateValue = computed(() => {
  return props.thing.modifiedAt || props.thing.createdAt || Date.now();
});

const isoDate = computed(() => {
  return new Date(dateValue.value).toISOString();
});

const fullDate = computed(() => {
  return new Date(dateValue.value).toLocaleString();
});

const relativeDate = computed(() => {
  const d = new Date(dateValue.value);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 0 || isNaN(diffMs)) return d.toLocaleDateString();

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
});

const renderedBody = computed(() => {
  const raw = props.thing.richContent || props.thing.content || '';
  return renderMarkdown(raw);
});

function isImageAttachment(att: AttachmentDescriptor): boolean {
  if (att.type === 'image') return true;
  if (att.mime?.startsWith('image/')) return true;
  const name = att.fileName?.toLowerCase() || '';
  return /\.(png|jpe?g|gif|webp|svg)$/.test(name);
}

function attachmentUrl(att: AttachmentDescriptor): string {
  return `/api/files/${props.thing.ownerId || 'me'}/${props.thing._id}/${att.identifier}`;
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
</script>

<style scoped>
.note-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 1.25rem;
  margin-bottom: 1rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  transition: box-shadow 0.2s, border-color 0.2s;
}

.note-card:hover {
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.08);
  border-color: #cbd5e0;
}

.note-card.is-sticky {
  border-left: 4px solid #3182ce;
  background-color: #fcfdfd;
}

.note-card.is-archived {
  opacity: 0.85;
  background-color: #fafbfc;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.header-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.note-time {
  font-size: 0.85rem;
  color: #718096;
}

.badge {
  font-size: 0.75rem;
  font-weight: 500;
  padding: 0.15rem 0.4rem;
  border-radius: 4px;
}

.badge-sticky {
  background-color: #ebf8ff;
  color: #2b6cb0;
}

.badge-public {
  background-color: #f0fff4;
  color: #276749;
}

.badge-shared {
  background-color: #faf5ff;
  color: #6b46c1;
}

.badge-archived {
  background-color: #edf2f7;
  color: #4a5568;
}

.card-body {
  font-size: 0.95rem;
  line-height: 1.6;
  color: #2d3748;
  word-break: break-word;
}

.card-attachments {
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid #edf2f7;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.attachment-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  color: #3182ce;
  text-decoration: none;
}

.attachment-link:hover {
  text-decoration: underline;
}

.attachment-size {
  color: #a0aec0;
  font-size: 0.75rem;
}

.card-footer {
  margin-top: 0.75rem;
  padding-top: 0.5rem;
}

.tags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.tag-pill {
  background-color: #edf2f7;
  border: 1px solid transparent;
  color: #4a5568;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.15rem 0.5rem;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tag-pill:hover {
  background-color: #e2e8f0;
  color: #2b6cb0;
  border-color: #cbd5e0;
}
</style>
