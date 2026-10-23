import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearOfflineData } from './pwa';

function setup(controller = true) {
  const port1 = { onmessage: null as ((event: { data: unknown }) => void) | null, close: vi.fn() };
  const port2 = { close: vi.fn() };
  const worker = { postMessage: vi.fn() };
  const getRegistration = vi.fn().mockResolvedValue({ active: worker });
  vi.stubGlobal('navigator', { serviceWorker: { controller: controller ? worker : null, getRegistration } });
  vi.stubGlobal('MessageChannel', vi.fn(function () { return { port1, port2 }; }));
  const caches = { keys: vi.fn().mockResolvedValue(['meemo-data-v1', 'meemo-shell-v1']), delete: vi.fn().mockResolvedValue(true) };
  vi.stubGlobal('caches', caches);
  return { worker, getRegistration, caches, port1, port2 };
}

describe('offline cache cleanup', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it.each([true, false])('waits for worker acknowledgement instead of deleting its cache (controlled=%s)', async (controlled) => {
    const { worker, caches, port1, port2 } = setup(controlled);
    let finished = false;
    const clearing = clearOfflineData().then(() => { finished = true; });
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: 'CLEAR_OFFLINE_DATA' }, [port2]));
    expect(finished).toBe(false);
    expect(caches.delete).not.toHaveBeenCalled();
    port1.onmessage!({ data: { ok: true } });
    await clearing;
    expect(finished).toBe(true);
    expect(port1.close).toHaveBeenCalledOnce();
    expect(port2.close).toHaveBeenCalledOnce();
  });

  it('rejects a failed worker clear without independently deleting newer data', async () => {
    const { worker, caches, port1 } = setup();
    const clearing = clearOfflineData();
    const rejected = expect(clearing).rejects.toThrow('Offline cache cleanup failed');
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    port1.onmessage!({ data: { ok: false } });
    await rejected;
    expect(caches.delete).not.toHaveBeenCalled();
  });

  it('times out without scheduling a late fallback deletion', async () => {
    const { worker, caches } = setup();
    const clearing = clearOfflineData();
    const rejected = expect(clearing).rejects.toThrow('Offline cache cleanup timed out');
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    await vi.runAllTimersAsync();
    await rejected;
    expect(caches.delete).not.toHaveBeenCalled();
  });

  it('removes only private caches when there is no active worker', async () => {
    const { caches, getRegistration } = setup(false);
    getRegistration.mockResolvedValue(undefined);
    await clearOfflineData();
    expect(caches.delete).toHaveBeenCalledExactlyOnceWith('meemo-data-v1');
  });

  it('reports direct deletion failures', async () => {
    const { caches, getRegistration } = setup(false);
    getRegistration.mockResolvedValue(undefined);
    caches.delete.mockRejectedValue(new Error('storage unavailable'));
    await expect(clearOfflineData()).rejects.toThrow('storage unavailable');
  });

  it('works without CacheStorage or ServiceWorker support', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('caches', undefined);
    await expect(clearOfflineData()).resolves.toBeUndefined();
  });
});
