<template>
  <section class="assistant-view" aria-labelledby="assistant-heading" :aria-busy="loading || busy">
    <router-link to="/">← Back to notes</router-link>
    <h1 id="assistant-heading">{{ authorizing ? 'Connect an assistant' : 'Assistant connections' }}</h1>
    <p v-if="!isAuthenticated">Log in to your Meemo account to continue.</p>
    <button v-if="!isAuthenticated" type="button" @click="openAuthModal?.('login')">Log in</button>
    <p v-else-if="loading" role="status">Loading connection details…</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="isAuthenticated && !loading">
      <template v-if="authorizing && consent">
        <p><strong>{{ consent.clientName }}</strong> is requesting access to <strong>{{ consent.username }}</strong>'s notes.</p>
        <p v-if="hasWriteScope">
          This allows searching, reading, creating, editing, and deleting (moving to trash) your private notes, including archived notes by ID, and listing tags. Retrieved content may be sent to Google. Sharing and downloading attachments are not allowed.
        </p>
        <p v-else>
          This allows searching and reading all your private notes, including archived notes by ID, and listing tags. Retrieved content may be sent to Google. Writing, deleting, sharing and downloading attachments are not allowed.
        </p>
        <p>Access expires after 24 hours; reconnect to renew it. You can revoke access here, but cannot take back content already sent.</p>
        <label class="acknowledgement">
          <input v-model="acknowledged" type="checkbox" :disabled="busy" />
          I understand that private note content may be sent to Google.
        </label>
        <div class="actions">
          <button type="button" :disabled="busy" @click="decide(false)">Deny</button>
          <button type="button" class="primary" :disabled="busy || !acknowledged" @click="decide(true)">{{ hasWriteScope ? 'Allow read & write access' : 'Allow read access' }}</button>
        </div>
      </template>
      <template v-else-if="!authorizing && connections">
        <p>Add this HTTPS MCP address as a custom app in Gemini, then sign in and approve access:</p>
        <code class="resource">{{ connections.resource }}</code>
        <p>Access expires after 24 hours. Reconnect after expiry.</p>
        <p v-if="connections.connections.length === 0">No active assistant connections.</p>
        <ul v-else>
          <li v-for="connection in connections.connections" :key="connection.id">
            <div><strong>{{ connection.clientName }}</strong><br /><span>{{ formatScope(connection.scope) }} · expires {{ formatDate(connection.expiresAt) }}</span></div>
            <button type="button" :disabled="busy" :aria-label="`Revoke ${connection.clientName}`" @click="revoke(connection.id)">Revoke</button>
          </li>
        </ul>
        <p>Revoking stops subsequent calls, not content already returned. Logging out of Meemo does not revoke these connections.</p>
      </template>
      <p v-if="notice" role="status">{{ notice }}</p>
      <button v-if="error" type="button" :disabled="busy" @click="load">Retry</button>
    </template>
    <router-link v-if="authorizing" to="/assistant/connections">Manage connections</router-link>
  </section>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError, type McpConnectionsResponse, type McpConsentResponse } from '../api/client';
import { useAuth } from '../composables/useAuth';

const route = useRoute();
const { user, isAuthenticated } = useAuth();
const openAuthModal = inject<(tab: 'login' | 'register') => void>('openAuthModal');
const authorizing = computed(() => route.name === 'assistant-authorize');
const requestId = computed(() => typeof route.query.request === 'string' ? route.query.request : '');
const consent = ref<McpConsentResponse | null>(null);
const hasWriteScope = computed(() => !!consent.value?.scope && consent.value.scope.includes('notes.write'));
const connections = ref<McpConnectionsResponse | null>(null);
const acknowledged = ref(false);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const notice = ref('');
let generation = 0;

function message(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'Assistant access is disabled on this server. Contact your administrator.';
  if (err instanceof ApiError && err.status === 401) return 'Please log in again to continue.';
  return 'Unable to complete the request. It may have expired; reconnect from Gemini or retry.';
}

async function load() {
  const current = ++generation;
  consent.value = null;
  connections.value = null;
  acknowledged.value = false;
  error.value = '';
  notice.value = '';
  if (!isAuthenticated.value) { loading.value = false; return; }
  loading.value = true;
  try {
    if (authorizing.value) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(requestId.value)) throw new Error('Missing request');
      const response = await api.mcp.consent(requestId.value);
      if (current === generation) consent.value = response;
    } else {
      const response = await api.mcp.connections();
      if (current === generation) connections.value = response;
    }
  } catch (err) {
    if (current === generation) error.value = message(err);
  } finally {
    if (current === generation) loading.value = false;
  }
}

async function decide(allow: boolean) {
  if (busy.value || !consent.value || (allow && !acknowledged.value)) return;
  busy.value = true;
  const current = generation;
  try {
    const response = await api.mcp.decide(requestId.value, allow, consent.value.csrfToken);
    if (current === generation) window.location.assign(response.redirectUrl);
  } catch (err) {
    if (current === generation) error.value = message(err);
  } finally { busy.value = false; }
}

async function revoke(id: string) {
  if (busy.value || !connections.value) return;
  busy.value = true;
  const current = generation;
  try {
    await api.mcp.revoke(id, connections.value.csrfToken);
    if (current === generation && connections.value) {
      connections.value.connections = connections.value.connections.filter(connection => connection.id !== id);
      notice.value = 'Connection revoked.';
    }
  } catch (err) {
    if (current === generation) error.value = message(err);
  } finally { busy.value = false; }
}

function formatScope(scope?: string) {
  if (scope && scope.includes('write')) return 'Read & write access';
  return 'Read access';
}
function formatDate(value: string) { return new Date(value).toLocaleString(); }
watch(() => [user.value?.id, route.name, requestId.value], load, { immediate: true });
onBeforeUnmount(() => { generation++; });
</script>

<style scoped>
.assistant-view { max-width: 680px; margin: 2rem auto; padding: 1.5rem; color: var(--md-sys-color-on-surface); }
h1 { font-size: 1.5rem; }
p { line-height: 1.6; }
a { color: var(--md-sys-color-primary); }
.resource { display: block; padding: 1rem; overflow-wrap: anywhere; background: var(--md-sys-color-surface-container-high); border-radius: 8px; }
.acknowledgement { display: flex; gap: .75rem; align-items: baseline; line-height: 1.6; }
.actions { display: flex; flex-wrap: wrap; gap: .75rem; margin: 1.5rem 0; }
button { min-height: 44px; padding: .6rem 1rem; border: 1px solid var(--md-sys-color-outline-variant); border-radius: 8px; background: var(--md-sys-color-surface-container-high); color: var(--md-sys-color-on-surface); cursor: pointer; font: inherit; }
button.primary { background: var(--md-sys-color-primary); color: var(--md-sys-color-on-primary); }
button:disabled { opacity: .55; cursor: not-allowed; }
button:focus-visible, a:focus-visible, input:focus-visible { outline: 2px solid var(--md-sys-color-primary); outline-offset: 3px; }
.error { padding: 1rem; border-radius: 8px; background: var(--md-sys-color-error-container); color: var(--md-sys-color-on-error-container); }
ul { padding: 0; list-style: none; }
li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--md-sys-color-outline-variant); }
li span { color: var(--md-sys-color-on-surface-variant); }
</style>
