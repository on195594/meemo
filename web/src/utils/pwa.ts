// Register the service worker in production builds only; dev servers must not serve cached assets.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => console.warn('Service worker registration failed:', err));
  });
}

// Ask the cache owner to fence in-flight reads too; never delete its cache from the page.
export async function clearOfflineData(): Promise<void> {
  const serviceWorker = typeof navigator !== 'undefined' && navigator.serviceWorker;
  const worker = serviceWorker && (serviceWorker.controller || (await serviceWorker.getRegistration())?.active);
  if (worker) {
    const channel = new MessageChannel();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Offline cache cleanup timed out')), 5000);
      channel.port1.onmessage = ({ data }) => {
        clearTimeout(timeout);
        if (data?.ok === true) resolve();
        else reject(new Error('Offline cache cleanup failed'));
      };
      try {
        worker.postMessage({ type: 'CLEAR_OFFLINE_DATA' }, [channel.port2]);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
      }
    }).finally(() => { channel.port1.close(); channel.port2.close(); });
    return;
  }
  if (typeof caches === 'undefined') return;
  for (const name of await caches.keys()) {
    if (name.startsWith('meemo-data-')) await caches.delete(name);
  }
}
