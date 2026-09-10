<template>
  <div
    v-if="modelValue"
    class="modal-overlay"
    @click.self="handleClose"
    role="dialog"
    aria-modal="true"
    aria-labelledby="import-title"
  >
    <div class="modal-card">
      <header class="modal-header">
        <h2 id="import-title" class="modal-title">Import Notes Archive</h2>
        <button type="button" class="close-btn" @click="handleClose" aria-label="Close modal">
          &times;
        </button>
      </header>

      <div class="modal-body">
        <p class="import-desc">
          Select or drop a <code>.tar</code> archive previously exported from Meemo. Notes and attachments will be merged into your account.
        </p>

        <!-- Drop Zone -->
        <div
          class="drop-zone"
          :class="{ dragging: isDragging }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleFileDrop"
          @click="triggerFileSelect"
        >
          <span class="drop-icon">📦</span>
          <span v-if="selectedFile" class="file-name">
            {{ selectedFile.name }} ({{ formatFileSize(selectedFile.size) }})
          </span>
          <span v-else class="drop-text">
            Drop your <code>meemo-export.tar</code> here, or click to browse
          </span>
        </div>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden-file-input"
          accept=".tar,application/x-tar"
          @change="handleFileInputChange"
        />

        <!-- Upload & Extraction Progress Bar -->
        <div v-if="isImporting" class="progress-section">
          <div class="progress-bar-container">
            <div class="progress-fill" :style="{ width: uploadProgress + '%' }"></div>
          </div>
          <span class="progress-text">
            {{ uploadProgress < 100 ? `Uploading archive... ${uploadProgress}%` : 'Extracting and verifying notes...' }}
          </span>
        </div>

        <!-- Success Report -->
        <div v-if="successResult" class="success-banner" role="status">
          <strong>Import Complete!</strong>
          <p>
            Successfully imported {{ successResult.imported }} of {{ successResult.total }} notes from archive.
          </p>
        </div>

        <!-- Error Banner -->
        <div v-if="errorMessage" class="error-banner" role="alert">
          {{ errorMessage }}
        </div>
      </div>

      <footer class="modal-footer">
        <button
          type="button"
          class="btn-modal secondary"
          :disabled="isImporting"
          @click="handleClose"
        >
          {{ successResult ? 'Done' : 'Cancel' }}
        </button>
        <button
          v-if="!successResult"
          type="button"
          class="btn-modal primary"
          :disabled="!selectedFile || isImporting"
          @click="executeImport"
        >
          <span v-if="isImporting">Importing...</span>
          <span v-else>Start Import</span>
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api/client';

const props = defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
  (e: 'imported'): void;
}>();

const selectedFile = ref<File | null>(null);
const isDragging = ref(false);
const isImporting = ref(false);
const uploadProgress = ref(0);
const errorMessage = ref<string | null>(null);
const successResult = ref<{ total: number; imported: number; failed: number } | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

function triggerFileSelect() {
  if (isImporting.value) return;
  fileInputRef.value?.click();
}

function handleFileInputChange(event: Event) {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file) setFile(file);
}

function handleFileDrop(event: DragEvent) {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) setFile(file);
}

function setFile(file: File) {
  errorMessage.value = null;
  successResult.value = null;
  selectedFile.value = file;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function handleClose() {
  if (isImporting.value) return;
  if (successResult.value) {
    emit('imported');
  }
  selectedFile.value = null;
  successResult.value = null;
  errorMessage.value = null;
  uploadProgress.value = 0;
  emit('update:modelValue', false);
}

async function executeImport() {
  if (!selectedFile.value || isImporting.value) return;

  isImporting.value = true;
  uploadProgress.value = 0;
  errorMessage.value = null;
  successResult.value = null;

  try {
    const result = await api.transfer.importArchive(selectedFile.value, (pct) => {
      uploadProgress.value = pct;
    });
    successResult.value = result;
    emit('imported');
  } catch (err: any) {
    errorMessage.value = err.message || 'Import failed. Verify that archive is a valid Meemo tar file.';
  } finally {
    isImporting.value = false;
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
  background: #ffffff;
  border-radius: 10px;
  width: 100%;
  max-width: 480px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 1.5rem 0.75rem;
  border-bottom: 1px solid #edf2f7;
}

.modal-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1a202c;
  margin: 0;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  line-height: 1;
  color: #718096;
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
}

.close-btn:hover {
  color: #2d3748;
}

.modal-body {
  padding: 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.import-desc {
  font-size: 0.9rem;
  color: #4a5568;
  line-height: 1.5;
}

.import-desc code {
  background: #edf2f7;
  padding: 0.1rem 0.3rem;
  border-radius: 4px;
  font-size: 0.85rem;
}

.drop-zone {
  border: 2px dashed #cbd5e0;
  border-radius: 8px;
  padding: 2rem 1rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
  background-color: #f7fafc;
  transition: all 0.2s;
  text-align: center;
}

.drop-zone:hover,
.drop-zone.dragging {
  border-color: #3182ce;
  background-color: #ebf8ff;
}

.drop-icon {
  font-size: 2rem;
}

.drop-text {
  font-size: 0.85rem;
  color: #718096;
}

.file-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: #2b6cb0;
}

.hidden-file-input {
  display: none;
}

.progress-section {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.progress-bar-container {
  height: 8px;
  background-color: #edf2f7;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background-color: #3182ce;
  transition: width 0.2s ease;
}

.progress-text {
  font-size: 0.8rem;
  color: #718096;
  text-align: center;
}

.success-banner {
  background-color: #f0fff4;
  border: 1px solid #c6f6d5;
  color: #276749;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.875rem;
}

.error-banner {
  background-color: #fff5f5;
  border: 1px solid #fed7d7;
  color: #c53030;
  border-radius: 6px;
  padding: 0.75rem;
  font-size: 0.875rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  padding: 0.75rem 1.5rem 1.25rem;
  border-top: 1px solid #edf2f7;
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
  background-color: #2b6cb0;
  color: #ffffff;
  border: 1px solid transparent;
}

.btn-modal.primary:hover:not(:disabled) {
  background-color: #2c5282;
}

.btn-modal.secondary {
  background-color: #edf2f7;
  color: #4a5568;
  border: 1px solid #cbd5e0;
}

.btn-modal.secondary:hover:not(:disabled) {
  background-color: #e2e8f0;
}

.btn-modal:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
