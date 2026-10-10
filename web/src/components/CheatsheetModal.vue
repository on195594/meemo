<template>
  <div
    v-if="modelValue"
    class="modal-overlay"
    @click.self="handleClose"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cheatsheet-title"
  >
    <div class="modal-card">
      <header class="modal-header">
        <h2 id="cheatsheet-title" class="modal-title">Markdown & Shortcuts Cheatsheet</h2>
        <button type="button" class="close-btn" @click="handleClose" aria-label="Close modal">
          &times;
        </button>
      </header>

      <div class="modal-body">
        <section class="cheatsheet-section">
          <h3>Keyboard Shortcuts</h3>
          <table class="cheat-table">
            <tbody>
              <tr>
                <td><kbd>Ctrl</kbd> + <kbd>Enter</kbd> / <kbd>Cmd</kbd> + <kbd>Enter</kbd></td>
                <td>Save note in composer or during inline editing</td>
              </tr>
              <tr>
                <td><kbd>Ctrl</kbd> + <kbd>S</kbd> / <kbd>Cmd</kbd> + <kbd>S</kbd></td>
                <td>Save changes during inline note edit</td>
              </tr>
              <tr>
                <td><kbd>Esc</kbd></td>
                <td>Cancel editing or dismiss active modal</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section class="cheatsheet-section">
          <h3>Markdown Syntax</h3>
          <table class="cheat-table">
            <thead>
              <tr>
                <th>Element</th>
                <th>Markdown Syntax</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Headings</td>
                <td><code># Heading 1</code>, <code>## Heading 2</code></td>
              </tr>
              <tr>
                <td>Emphasis</td>
                <td><code>**bold**</code>, <code>*italic*</code>, <code>~~strike~~</code></td>
              </tr>
              <tr>
                <td>Tags</td>
                <td><code>#project</code>, <code>#meeting</code> (auto-linked)</td>
              </tr>
              <tr>
                <td>WikiLinks (Internal Links)</td>
                <td><code>[[Note Title]]</code>, <code>[[Target|Custom Label]]</code></td>
              </tr>
              <tr>
                <td>Lists</td>
                <td><code>- Item</code>, <code>1. Numbered</code>, <code>- [ ] Task</code></td>
              </tr>
              <tr>
                <td>Code</td>
                <td><code>`inline code`</code>, <code>```code block```</code></td>
              </tr>
              <tr>
                <td>Links & Images</td>
                <td><code>[link](url)</code>, <code>![alt](image-url)</code></td>
              </tr>
              <tr>
                <td>Blockquote</td>
                <td><code>> Quoted text</code></td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      <footer class="modal-footer">
        <button type="button" class="btn-modal secondary" @click="handleClose">
          Close
        </button>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function handleClose() {
  emit('update:modelValue', false);
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
  border: 1px solid var(--md-sys-color-outline-variant, rgba(0, 0, 0, 0.1));
  border-radius: var(--md-sys-shape-corner-2xl, 28px);
  width: 100%;
  max-width: 540px;
  box-shadow: var(--md-sys-elevation-3, 0 10px 25px rgba(0, 0, 0, 0.15));
  overflow: hidden;
  max-height: 85vh;
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
  font-size: 1.2rem;
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
  border-radius: var(--md-sys-shape-corner-xs, 4px);
}

.close-btn:hover {
  color: var(--md-sys-color-on-surface, #2d3748);
}

.modal-body {
  padding: 1.25rem 1.5rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.cheatsheet-section h3 {
  font-size: 1rem;
  color: var(--md-sys-color-primary, #0b57d0);
  margin-bottom: 0.5rem;
  font-weight: 600;
}

.cheat-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.cheat-table th,
.cheat-table td {
  padding: 0.45rem 0.6rem;
  border: 1px solid var(--md-sys-color-outline-variant, #e2e8f0);
  text-align: left;
}

.cheat-table th {
  background-color: var(--md-sys-color-surface-container-high, #f7fafc);
  color: var(--md-sys-color-on-surface, #4a5568);
}

.cheat-table td {
  color: var(--md-sys-color-on-surface-variant, #2d3748);
}

.cheat-table code {
  background: var(--md-sys-color-surface-container-high, #edf2f7);
  color: var(--md-sys-color-on-surface, inherit);
  padding: 0.1rem 0.35rem;
  border-radius: var(--md-sys-shape-corner-xs, 4px);
  font-family: monospace;
  font-size: 0.85rem;
}

kbd {
  background: var(--md-sys-color-surface-container-high, #edf2f7);
  color: var(--md-sys-color-on-surface, inherit);
  border: 1px solid var(--md-sys-color-outline-variant, #cbd5e0);
  border-radius: var(--md-sys-shape-corner-xs, 3px);
  padding: 0.1rem 0.3rem;
  font-size: 0.75rem;
  font-family: monospace;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 0.75rem 1.5rem 1.25rem;
  border-top: 1px solid var(--md-sys-color-outline-variant, #edf2f7);
}

.btn-modal {
  padding: 0.45rem 1rem;
  border-radius: var(--md-sys-shape-corner-sm, 8px);
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  background-color: var(--md-sys-color-surface-container-high, #edf2f7);
  color: var(--md-sys-color-on-surface, #4a5568);
  border: 1px solid var(--md-sys-color-outline-variant, #cbd5e0);
  transition: opacity 0.2s;
}

.btn-modal:hover {
  opacity: 0.9;
}
</style>
