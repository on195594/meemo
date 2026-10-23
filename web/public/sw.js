// Meemo service worker: cached app assets for instant start, cached reads for offline viewing.
// Writes, auth, assistant/OAuth and file routes always go straight to the network.
const VERSION = 'v1';
const SHELL = 'meemo-shell-' + VERSION;
const DATA = 'meemo-data-v2'; // isolate requests still running in the pre-fix worker
const INVALID_DATA = '/__meemo_offline_invalid__';
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

let dataGeneration = 0;
let authChanges = 0;
let dataAvailable = false;
let dataOperations = caches.match(INVALID_DATA, { cacheName: SHELL }).then((invalid) => {
  if (dataGeneration === 0) dataAvailable = !invalid;
}, () => {});

// Serialize storage, not fetches: deletion must also fence an already-running open/put.
function withData(operation) {
  const result = dataOperations.then(operation);
  dataOperations = result.catch(() => {});
  return result;
}

function invalidateData() {
  const generation = ++dataGeneration;
  dataAvailable = false;
  return withData(async () => {
    let shell;
    try {
      // Keep failed cleanup invalid across worker termination, not just in memory.
      shell = await caches.open(SHELL);
      await shell.put(INVALID_DATA, new Response('invalid'));
    } catch (error) {
      await caches.delete(DATA);
      throw error;
    }
    await caches.delete(DATA);
    await shell.delete(INVALID_DATA);
    if (generation === dataGeneration) dataAvailable = true;
  });
}

function isCurrent(generation) {
  return generation === dataGeneration && !authChanges && dataAvailable;
}

async function api(request, cacheable = true) {
  const generation = dataGeneration;
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    if (cacheable) {
      const cached = await withData(async () => {
        if (!isCurrent(generation)) return;
        const match = await caches.match(request, { cacheName: DATA });
        if (isCurrent(generation)) return match;
      }).catch(() => undefined);
      if (cached && isCurrent(generation)) return cached;
    }
    throw error;
  }

  // Cache failures must never replace a real network response with an offline fallback.
  if (response.status === 401 && generation === dataGeneration) {
    await invalidateData().catch(() => {});
  } else if (cacheable && response.ok) {
    await withData(async () => {
      if (!isCurrent(generation)) return;
      const cache = await caches.open(DATA);
      if (isCurrent(generation)) await cache.put(request, response.clone());
    }).catch(() => {});
  }
  return response;
}

async function changeSession(request) {
  authChanges++;
  try {
    await invalidateData().catch(() => {});
    return await fetch(request);
  } finally {
    await invalidateData().catch(() => {});
    authChanges--;
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

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CLEAR_OFFLINE_DATA' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil(invalidateData().then(
    () => port.postMessage({ ok: true }),
    () => port.postMessage({ ok: false }),
  ));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const strategy = strategyFor(request);
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) {
    if (request.method === 'POST' && /^\/api\/(login|logout)$/.test(url.pathname)) {
      event.respondWith(changeSession(request));
    } else if (!/^\/api\/(login|register)(\/|$)/.test(url.pathname)) {
      // Observe expiry on writes/XHR too, without caching their responses.
      event.respondWith(api(request, strategy === 'api'));
    }
  } else if (strategy) event.respondWith(handlers[strategy](request));
});
