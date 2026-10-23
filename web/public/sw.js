// Meemo service worker: cached app assets for instant start, cached reads for offline viewing.
// Writes, auth, assistant/OAuth and file routes always go straight to the network.
const VERSION = 'v1';
const SHELL = 'meemo-shell-' + VERSION;
const DATA = 'meemo-data-' + VERSION; // private notes; the page deletes it on logout
const NAVIGATION_TIMEOUT_MS = 2500;
const BYPASS = /^\/(mcp|oauth|\.well-known|assistant|api\/(mcp|files|export|import|login|logout|register|health|healthcheck))(\/|$)/;

function strategyFor(request) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || BYPASS.test(url.pathname)) return null;
  if (url.pathname.startsWith('/api/')) return request.mode === 'navigate' ? null : 'api';
  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/assets/')) return 'asset';
  return null;
}

// Fresh HTML keeps hashed asset names consistent with the deployed build; the cached shell is the
// fallback when the network is down or slower than the timeout.
async function navigate(request) {
  const cache = await caches.open(SHELL);
  const network = fetch(request).then(async (response) => {
    // Every SPA route serves the same index.html; never store other documents (e.g. errors) as the shell.
    if (response.ok && (response.headers.get('content-type') || '').startsWith('text/html')) {
      await cache.put('/', response.clone());
    }
    return response;
  });
  try {
    return await Promise.race([
      network,
      new Promise((_, reject) => setTimeout(reject, NAVIGATION_TIMEOUT_MS, new Error('timeout'))),
    ]);
  } catch {
    return (await cache.match('/')) || network;
  }
}

// shortcut: hashed assets from older deploys stay until VERSION changes; bump it if the shell cache grows too large.
async function asset(request) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

// Open the data cache only to store, so a 401 deletion is not followed by an empty re-created cache.
async function api(request) {
  try {
    const response = await fetch(request);
    if (response.status === 401) await caches.delete(DATA);
    else if (response.ok) await (await caches.open(DATA)).put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(request, { cacheName: DATA });
    if (cached) return cached;
    throw error;
  }
}

const handlers = { navigate, asset, api };

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, DATA];
    for (const name of await caches.keys()) {
      if (name.startsWith('meemo-') && !keep.includes(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const strategy = strategyFor(event.request);
  if (strategy) event.respondWith(handlers[strategy](event.request));
});
