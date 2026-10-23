import { describe, expect, it, vi } from 'vitest';
import source from '../public/sw.js?raw';

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, 'https://notes.test').pathname;
  return {
    stores,
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: async (request: string | { url: string }) => store.get(key(request))?.clone(),
        put: async (request: string | { url: string }, response: Response) => { store.set(key(request), response); },
      };
    },
    match: async (request: { url: string }, options: { cacheName: string }) => stores.get(options.cacheName)?.get(key(request))?.clone(),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
  };
}

function load(fetchImpl: (request: unknown) => Promise<Response>) {
  const caches = fakeCaches();
  const self = { location: { origin: 'https://notes.test' }, addEventListener: vi.fn(), clients: { claim: vi.fn() } };
  const sw = new Function('self', 'caches', 'fetch', `${source}; return { strategyFor, navigate, api };`)(self, caches, fetchImpl);
  return { sw, caches };
}

const get = (path: string, mode = 'cors') => ({ url: 'https://notes.test' + path, method: 'GET', mode });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('service worker', () => {
  it('only handles same-origin reads outside auth, assistant and file routes', () => {
    const { sw } = load(vi.fn());
    expect(sw.strategyFor(get('/', 'navigate'))).toBe('navigate');
    expect(sw.strategyFor(get('/note/abc', 'navigate'))).toBe('navigate');
    expect(sw.strategyFor(get('/assets/index-1.js'))).toBe('asset');
    expect(sw.strategyFor(get('/api/things?skip=0'))).toBe('api');
    for (const request of [
      { ...get('/api/things'), method: 'PUT' },
      get('/mcp'), get('/oauth/token'), get('/assistant/authorize', 'navigate'), get('/api/mcp/connections'),
      get('/api/files/u/t/f.jpg'), get('/api/login'), get('/api/rss/user', 'navigate'),
      { url: 'https://elsewhere.test/assets/a.js', method: 'GET', mode: 'cors' },
    ]) expect(sw.strategyFor(request)).toBeNull();
  });

  it('serves fresh HTML online, caches only HTML as the shell, and falls back to it offline', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(html('<html>v2</html>'))
      .mockResolvedValueOnce(new Response('not html', { headers: { 'content-type': 'application/xml' } }))
      .mockRejectedValueOnce(new TypeError('offline'));
    const { sw } = load(fetchImpl);

    expect(await (await sw.navigate(get('/', 'navigate'))).text()).toBe('<html>v2</html>');
    await sw.navigate(get('/feed', 'navigate'));
    expect(await (await sw.navigate(get('/note/1', 'navigate'))).text()).toBe('<html>v2</html>');
  });

  it('reads notes from the network, falls back offline, and drops cached data after a 401', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"things":[1]}'))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);

    await sw.api(get('/api/things'));
    expect(await (await sw.api(get('/api/things'))).text()).toBe('{"things":[1]}');
    expect((await sw.api(get('/api/things'))).status).toBe(401);
    expect(await caches.keys()).not.toContain('meemo-data-v1');
  });
});
