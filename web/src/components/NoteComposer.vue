<template>
  <div class="note-composer-card" :class="{ focused: isFocused || content.trim().length > 0 }">
    <div class="composer-body">
      <textarea
        ref="textareaRef"
        v-model="content"
        class="composer-textarea"
        placeholder="Write a note... (#tags, markdown supported)"
        rows="3"
        :disabled="isSaving"
        @focus="isFocused = true"
        @blur="handleBlur"
        @keydown="handleKeyDown"
      ></textarea>
    </div>

    <!-- Error Banner -->
    <div v-if="error" class="composer-error" role="alert">
      {{ error }}
    </div>

    <!-- Action Bar (visible when focused or has content) -->
    <div v-show="isFocused || content.trim().length > 0" class="composer-actions">
      <div class="shortcut-hint">
        <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to save
      </div>
      <div class="btn-group">
        <button
          v-if="content.trim().length > 0"
          type="button"
          class="btn-composer secondary"
          :disabled="isSaving"
          @click="handleCancel"
        >
          Clear
        </button>
        <button
          type="button"
          class="btn-composer primary"
          :disabled="isSaving || !content.trim()"
          @click="handleSubmit"
        >
          <span v-if="isSaving">Saving...</span>
          <span v-else>Save Note</span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  onSave: (content: string) => Promise<{ success: boolean; error?: string }>;
}>();

const emit = defineEmits<{
  (e: 'created'): void;
}>();

const content = ref('');
const isFocused = ref(false);
const isSaving = ref(false);
const error = ref<string | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);

function handleBlur() {
  // Delay blur to allow button clicks to register
  setTimeout(() => {
    if (!content.value.trim()) {
      isFocused.value = false;
    }
  }, 150);
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handleSubmit();
  } else if (e.key === 'Escape' && !content.value.trim()) {
    isFocused.value = false;
    textareaRef.value?.blur();
  }
}

function handleCancel() {
  content.value = '';
  error.value = null;
  isFocused.value = false;
  textareaRef.value?.blur();
}

async function handleSubmit() {
  const trimmed = content.value.trim();
  if (!trimmed || isSaving.value) return;

  isSaving.value = true;
  error.value = null;

  const result = await props.onSave(trimmed);
  if (result.success) {
    content.value = '';
    isFocused.value = false;
    emit('created');
  } else {
    error.value = result.error || 'Failed to save note';
  }
  isSaving.value = false;
}

function focus() {
  textareaRef.value?.focus();
}

defineExpose({
  focus,
  content,
});
</script>

<style scoped>
.note-composer-card {
  background: #ffffff;
  border: 1px solid #cbd5e0;
  border-radius: 8px;
  padding: 0.85rem 1rem;
  margin-bottom: 1.5rem;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.note-composer-card.focused {
  border-color: #3182ce;
  box-shadow: 0 0 0 2px rgba(49, 130, 206, 0.15);
}

.composer-body {
  width: 100%;
}

.composer-textarea {
  width: 100%;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
  font-size: 0.95rem;
  line-height: 1.5;
  color: #2d3748;
}

.composer-textarea::placeholder {
  color: #a0aec0;
}

.composer-error {
  background-color: #fff5f5;
  color: #c53030;
  border: 1px solid #fed7d7;
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  font-size: 0.85rem;
  margin-top: 0.5rem;
}

.composer-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.75rem;
  padding-top: 0.5rem;
  border-top: 1px solid #edf2f7;
}

.shortcut-hint {
  font-size: 0.75rem;
  color: #718096;
}

.shortcut-hint kbd {
  background: #edf2f7;
  border: 1px solid #cbd5e0;
  border-radius: 3px;
  padding: 0.1rem 0.3rem;
  font-size: 0.7rem;
  font-family: monospace;
}

.btn-group {
  display: flex;
  gap: 0.5rem;
}

.btn-composer {
  padding: 0.4rem 0.9rem;
  border-radius: 6px;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-composer.primary {
  background-color: #2b6cb0;
  color: #ffffff;
  border: 1px solid transparent;
}

.btn-composer.primary:hover:not(:disabled) {
  background-color: #2c5282;
}

.btn-composer.secondary {
  background-color: transparent;
  color: #718096;
  border: 1px solid transparent;
}

.btn-composer.secondary:hover:not(:disabled) {
  background-color: #edf2f7;
  color: #2d3748;
}

.btn-composer:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
