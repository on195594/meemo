<template>
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div
        v-if="open && currentImage"
        ref="dialogRef"
        class="lightbox-overlay"
        role="dialog"
        aria-modal="true"
        aria-label="Image preview"
        tabindex="-1"
        @click="handleBackdropClick"
      >
        <!-- Top Toolbar -->
        <div class="lightbox-header" @click.stop>
          <div class="lightbox-counter" v-if="images.length > 1">
            {{ currentIndex + 1 }} / {{ images.length }}
          </div>
          <div class="lightbox-title" :title="currentImage.title || currentImage.alt">
            {{ currentImage.title || currentImage.alt || '' }}
          </div>
          <div class="lightbox-actions">
            <a
              :href="currentImage.src"
              target="_blank"
              rel="noopener noreferrer"
              class="lightbox-btn"
              title="Open original image in new tab"
              aria-label="Open original image in new tab"
            >
              ↗
            </a>
            <button
              ref="closeBtnRef"
              type="button"
              class="lightbox-btn close-btn"
              title="Close preview (Esc)"
              aria-label="Close image preview"
              @click="close"
            >
              ✕
            </button>
          </div>
        </div>

        <!-- Main Image Container -->
        <div class="lightbox-stage">
          <button
            v-if="images.length > 1"
            type="button"
            class="nav-btn prev-btn"
            title="Previous image (Left arrow)"
            aria-label="Previous image"
            @click.stop="prev"
          >
            ‹
          </button>

          <div class="image-wrapper" @click.stop>
            <img
              :key="currentImage.src"
              :src="currentImage.src"
              :alt="currentImage.alt || 'Note image'"
              class="lightbox-img"
              loading="eager"
            />
          </div>

          <button
            v-if="images.length > 1"
            type="button"
            class="nav-btn next-btn"
            title="Next image (Right arrow)"
            aria-label="Next image"
            @click.stop="next"
          >
            ›
          </button>
        </div>

        <!-- Bottom Caption -->
        <div v-if="currentImage.alt" class="lightbox-footer" @click.stop>
          <span class="lightbox-caption">{{ currentImage.alt }}</span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onUnmounted, nextTick } from 'vue';

export interface LightboxImage {
  src: string;
  alt?: string;
  title?: string;
}

const props = withDefaults(
  defineProps<{
    open: boolean;
    images: LightboxImage[];
    initialIndex?: number;
  }>(),
  {
    initialIndex: 0,
  }
);

const emit = defineEmits<{
  (e: 'close'): void;
}>();

const dialogRef = ref<HTMLElement | null>(null);
const closeBtnRef = ref<HTMLButtonElement | null>(null);
const currentIndex = ref(props.initialIndex);
let originalOverflow = '';
let previousActiveElement: HTMLElement | null = null;

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document === 'undefined') return;
    if (isOpen) {
      previousActiveElement = document.activeElement as HTMLElement | null;
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeydown);
      nextTick(() => {
        closeBtnRef.value?.focus();
      });
    } else {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeydown);
      previousActiveElement?.focus();
    }
  },
  { immediate: true }
);

watch(
  () => [props.open, props.initialIndex, props.images.length],
  ([isOpen, newIndex]) => {
    if (isOpen) {
      const idx = typeof newIndex === 'number' ? newIndex : 0;
      currentIndex.value = Math.max(0, Math.min(idx, props.images.length - 1));
    }
  },
  { immediate: true }
);

const currentImage = computed(() => {
  if (!props.images || props.images.length === 0) return null;
  return props.images[currentIndex.value] || props.images[0];
});

function prev() {
  if (props.images.length <= 1) return;
  currentIndex.value = (currentIndex.value - 1 + props.images.length) % props.images.length;
}

function next() {
  if (props.images.length <= 1) return;
  currentIndex.value = (currentIndex.value + 1) % props.images.length;
}

function close() {
  emit('close');
}

function handleBackdropClick(event: MouseEvent) {
  if (event.target === event.currentTarget) {
    close();
  }
}

function handleKeydown(event: KeyboardEvent) {
  if (!props.open) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    prev();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    next();
  } else if (event.key === 'Tab' && dialogRef.value) {
    const focusableEls = dialogRef.value.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableEls.length === 0) return;
    const firstEl = focusableEls[0];
    const lastEl = focusableEls[focusableEls.length - 1];
    if (event.shiftKey) {
      if (document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      }
    } else {
      if (document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    }
  }
}

onUnmounted(() => {
  if (typeof document !== 'undefined' && props.open) {
    document.body.style.overflow = originalOverflow;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleKeydown);
  }
});
</script>

<style scoped>
.lightbox-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  background-color: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  user-select: none;
}

.lightbox-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 1.5rem;
  color: #fff;
  z-index: 10;
}

.lightbox-counter {
  font-size: 0.9rem;
  font-weight: 500;
  opacity: 0.85;
  min-width: 50px;
}

.lightbox-title {
  flex: 1;
  text-align: center;
  font-size: 0.95rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding: 0 1rem;
  opacity: 0.9;
}

.lightbox-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.lightbox-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 1.1rem;
  cursor: pointer;
  text-decoration: none;
  transition: background-color 0.15s ease, transform 0.1s ease;
}

.lightbox-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}

.lightbox-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 1rem;
  position: relative;
  overflow: hidden;
}

.image-wrapper {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
}

.lightbox-img {
  max-width: 90vw;
  max-height: calc(100vh - 130px);
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.nav-btn {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  border: none;
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
  font-size: 2rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: background-color 0.15s ease, transform 0.1s ease;
  flex-shrink: 0;
}

.nav-btn:hover {
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.08);
}

.lightbox-footer {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem 1.5rem;
  color: rgba(255, 255, 255, 0.85);
  font-size: 0.875rem;
  text-align: center;
}

.lightbox-caption {
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 0.2s ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .nav-btn {
    width: 38px;
    height: 38px;
    font-size: 1.5rem;
  }

  .lightbox-header {
    padding: 0 0.75rem;
  }
}
</style>
