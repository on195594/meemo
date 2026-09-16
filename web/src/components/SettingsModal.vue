<template>
  <div
    v-if="modelValue"
    class="modal-overlay"
    @click.self="handleClose"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <div class="modal-card">
      <header class="modal-header">
        <h2 id="settings-title" class="modal-title">Settings</h2>
        <button type="button" class="close-btn" @click="handleClose" aria-label="Close modal">
          &times;
        </button>
      </header>

      <form @submit.prevent="handleSave" class="settings-form">
        <!-- Error Banner -->
        <div v-if="errorMessage" class="error-banner" role="alert">
          {{ errorMessage }}
        </div>

        <!-- Section: General / Title & Theme -->
        <div class="form-group">
          <label for="settings-title-input" class="form-label">Application Title</label>
          <input
            id="settings-title-input"
            v-model="formTitle"
            type="text"
            class="form-input"
            placeholder="Meemo"
            :disabled="isLoading"
          />
        </div>

        <div class="form-group">
          <label for="settings-theme-select" class="form-label">Theme Mode</label>
          <select
            id="settings-theme-select"
            v-model="formTheme"
            class="form-select"
            :disabled="isLoading"
          >
            <option value="auto">System (Auto)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>

        <!-- Section: Layout & Display -->
        <div class="form-group">
          <span class="form-label">Display & Layout</span>
          <div class="checkbox-list">
            <label class="checkbox-label">
              <input type="checkbox" v-model="formWide" :disabled="isLoading" />
              <span>Wide notes container</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="formWideNavbar" :disabled="isLoading" />
              <span>Wide navigation toolbar</span>
            </label>
            <label class="checkbox-label">
              <input type="checkbox" v-model="formPublicBackground" :disabled="isLoading" />
              <span>Show background image on public feed</span>
            </label>
          </div>
        </div>

        <!-- Section: Behavior -->
        <div class="form-group">
          <span class="form-label">Behavior</span>
          <div class="checkbox-list">
            <label class="checkbox-label">
              <input type="checkbox" v-model="formKeepPosition" :disabled="isLoading" />
              <span>Keep scroll position after edit</span>
            </label>
          </div>
        </div>

        <!-- Section: Background Image -->
        <div class="form-group">
          <span class="form-label">Custom Background Image</span>
          <div
            class="image-picker-box"
            :style="pickerStyle"
            @click="triggerImageSelect"
            title="Click to select background image"
          >
            <span v-if="!formBackgroundUrl" class="picker-placeholder">
              📷 Click to upload background image
            </span>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            class="hidden-file-input"
            accept="image/*"
            @change="handleImageSelected"
          />
          <div v-if="formBackgroundUrl" class="image-actions">
            <button type="button" class="btn-clear-bg" @click="formBackgroundUrl = ''">
              Remove background image
            </button>
          </div>
        </div>

        <footer class="modal-footer">
          <button type="button" class="btn-modal secondary" :disabled="isLoading" @click="handleClose">
            Cancel
          </button>
          <button type="submit" class="btn-modal primary" :disabled="isLoading">
            <span v-if="isLoading">Saving...</span>
            <span v-else>Save Settings</span>
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useSettings, type ThemeMode, getStoredTheme, setStoredTheme } from '../composables/useSettings';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'saved'): void;
}>();

const { settings, isLoading, saveSettings } = useSettings();

const formTitle = ref('Meemo');
const formTheme = ref<ThemeMode>('auto');
const formWide = ref(false);
const formWideNavbar = ref(false);
const formShowTagSidebar = ref(true);
const formPublicBackground = ref(false);
const formKeepPosition = ref(false);
const formBackgroundUrl = ref('');
const errorMessage = ref<string | null>(null);

const fileInputRef = ref<HTMLInputElement | null>(null);

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      errorMessage.value = null;
      formTitle.value = settings.value.title || 'Meemo';
      formTheme.value = settings.value.theme || getStoredTheme();
      formWide.value = !!settings.value.wide;
      formWideNavbar.value = !!settings.value.wideNavbar;
      formShowTagSidebar.value = settings.value.showTagSidebar !== false;
      formPublicBackground.value = !!settings.value.publicBackground;
      formKeepPosition.value = !!settings.value.keepPositionAfterEdit;
      formBackgroundUrl.value = settings.value.backgroundImageDataUrl || '';
    }
  },
  { immediate: true }
);

const pickerStyle = computed(() => {
  if (formBackgroundUrl.value) {
    return {
      backgroundImage: `url("${formBackgroundUrl.value}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return {};
});

function triggerImageSelect() {
  fileInputRef.value?.click();
}

function handleImageSelected(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;

  if (file.size > 2 * 1024 * 1024) {
    errorMessage.value = 'Background image must be smaller than 2MB';
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    formBackgroundUrl.value = String(e.target?.result || '');
    errorMessage.value = null;
  };
  reader.onerror = () => {
    errorMessage.value = 'Failed to read image file';
  };
  reader.readAsDataURL(file);
}

function handleClose() {
  emit('update:modelValue', false);
}

async function handleSave() {
  errorMessage.value = null;
  setStoredTheme(formTheme.value);
  const result = await saveSettings({
    title: formTitle.value.trim() || 'Meemo',
    theme: formTheme.value,
    wide: formWide.value,
    wideNavbar: formWideNavbar.value,
    showTagSidebar: formShowTagSidebar.value,
    publicBackground: formPublicBackground.value,
    keepPositionAfterEdit: formKeepPosition.value,
    backgroundImageDataUrl: formBackgroundUrl.value,
  });

  if (result.success) {
    emit('saved');
    emit('update:modelValue', false);
  } else {
    errorMessage.value = result.error || 'Failed to save settings';
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  padding: 1rem;
  backdrop-filter: blur(2px);
}

.modal-card {
  background: var(--md-sys-color-surface-container, #ffffff);
  border: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
  border-radius: 10px;
  width: 100%;
  max-width: 500px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem 0.75rem;
  border-bottom: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #1a202c);
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: var(--md-sys-color-on-surface-variant, #718096);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
}

.close-btn:hover {
  color: var(--md-sys-color-on-surface, #2d3748);
}

.settings-form {
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.error-banner {
  padding: 0.6rem 0.8rem;
  background-color: var(--md-sys-color-error-container, #fff5f5);
  border: 1px solid var(--md-sys-color-error, #fed7d7);
  color: var(--md-sys-color-on-error, #c53030);
  border-radius: 6px;
  font-size: 0.875rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.form-label {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--md-sys-color-on-surface, #4a5568);
}

.form-input,
.form-select {
  padding: 0.5rem 0.75rem;
  border: 1px solid var(--md-sys-color-outline-variant, #cbd5e0);
  border-radius: 6px;
  font-size: 0.95rem;
  outline: none;
  background-color: var(--md-sys-color-surface-container-low, #ffffff);
  color: var(--md-sys-color-on-surface, #1f1f1f);
}

.form-input:focus,
.form-select:focus {
  border-color: var(--md-sys-color-primary, #3182ce);
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-top: 0.25rem;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: var(--md-sys-color-on-surface, #2d3748);
  cursor: pointer;
}

.image-picker-box {
  width: 100%;
  height: 90px;
  border: 2px dashed var(--md-sys-color-outline-variant, #cbd5e0);
  border-radius: 8px;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  background-color: var(--md-sys-color-surface-container-low, #f7fafc);
  transition: border-color 0.2s;
}

.image-picker-box:hover {
  border-color: var(--md-sys-color-primary, #3182ce);
}

.picker-placeholder {
  font-size: 0.85rem;
  color: var(--md-sys-color-on-surface-variant, #718096);
}

.hidden-file-input {
  display: none;
}

.image-actions {
  margin-top: 0.35rem;
}

.btn-clear-bg {
  background: none;
  border: none;
  color: var(--md-sys-color-error, #e53e3e);
  font-size: 0.8rem;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
}

.btn-modal {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-modal.primary {
  background-color: var(--md-sys-color-primary, #2b6cb0);
  color: var(--md-sys-color-on-primary, #ffffff);
  border: 1px solid transparent;
}

.btn-modal.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-modal.secondary {
  background-color: var(--md-sys-color-surface-container-high, #edf2f7);
  color: var(--md-sys-color-on-surface, #4a5568);
  border: 1px solid var(--md-sys-color-outline-variant, #cbd5e0);
}

.btn-modal.secondary:hover:not(:disabled) {
  background-color: var(--md-sys-color-surface-container, #e2e8f0);
}

.btn-modal:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
