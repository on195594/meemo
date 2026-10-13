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
          @open-detail="openNoteModal"
          @wikilink-click="handleWikilinkClick"
          @image-click="handleImageClick"
        />
      </div>
      <div v-else class="empty-state">
        <p>No public notes available.</p>
      </div>
    </main>

    <NoteDetailModal
      :open="isNoteModalOpen"
      :thing="activeModalNote"
      :can-edit="false"
      @close="isNoteModalOpen = false"
      @wikilink-click="handleWikilinkClick"
      @image-click="handleImageClick"
    />

    <ImageLightbox
      :open="isLightboxOpen"
      :images="lightboxImages"
      :initial-index="lightboxIndex"
      @close="isLightboxOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type Thing, type PublicUserProfile } from '../api/client';
import NoteCard from '../components/NoteCard.vue';
import NoteDetailModal from '../components/NoteDetailModal.vue';
import ImageLightbox, { type LightboxImage } from '../components/ImageLightbox.vue';

const route = useRoute();
const router = useRouter();
const userId = String(route.params.userId);

const isNoteModalOpen = ref(false);
const activeModalNote = ref<Thing | null>(null);

function openNoteModal(thing: Thing) {
  activeModalNote.value = thing;
  isNoteModalOpen.value = true;
}

function handleWikilinkClick(target: string) {
  router.push({ path: '/', query: { q: target } });
}

const isLightboxOpen = ref(false);
const lightboxImages = ref<LightboxImage[]>([]);
const lightboxIndex = ref(0);

function handleImageClick(images: LightboxImage[], index: number) {
  lightboxImages.value = images;
  lightboxIndex.value = index;
  isLightboxOpen.value = true;
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
}
.stream-header {
  border-bottom: 1px solid var(--md-sys-color-outline-variant);
  padding-bottom: 1rem;
  margin-bottom: 1.5rem;
}
.stream-header h1 {
  font-size: var(--md-sys-typescale-headline-small);
  font-weight: 400;
  color: var(--md-sys-color-on-surface);
}
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
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
.empty-state {
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
  margin-top: 3rem;
}
</style>
