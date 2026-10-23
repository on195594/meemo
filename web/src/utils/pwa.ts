// Register the service worker in production builds only; dev servers must not serve cached assets.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed:', err));
  });
}

// Remove notes cached for offline reading (explicit logout).
export async function clearOfflineData(): Promise<void> {
  try {
    if (typeof caches === 'undefined') return;
    for (const name of await caches.keys()) {
      if (name.startsWith('meemo-data-')) await caches.delete(name);
    }
  } catch { /* Cache Storage unavailable */ }
}
