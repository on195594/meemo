<template>
  <div class="shared-note-view">
    <div v-if="loading" class="status-indicator">Loading shared note...</div>
    <div v-else-if="error" class="error-banner">{{ error }}</div>

    <main v-else-if="thing" class="shared-note-content">
      <NoteCard
        :thing="thing"
        :can-edit="false"
        @wikilink-click="handleWikilinkClick"
        @image-click="handleImageClick"
      />
    </main>

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
import { api, type Thing } from '../api/client';
import NoteCard from '../components/NoteCard.vue';
import ImageLightbox, { type LightboxImage } from '../components/ImageLightbox.vue';

const route = useRoute();
const router = useRouter();
const thingId = String(route.params.thingId);

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

const thing = ref<Thing | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
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
</style>
