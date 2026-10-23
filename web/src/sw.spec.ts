import { describe, expect, it, vi } from 'vitest';
import source from '../public/sw.js?raw';

function fakeCaches() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (request: string | { url: string }) => new URL(typeof request === 'string' ? request : request.url, 'https://notes.test').href;
  return {
    stores,
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name)!;
      return {
        match: async (request: string | { url: string }) => store.get(key(request))?.clone(),
        put: async (request: string | { url: string }, response: Response) => { store.set(key(request), response); },
        delete: async (request: string | { url: string }) => store.delete(key(request)),
      };
    },
    match: async (request: { url: string }, options: { cacheName: string }) => stores.get(options.cacheName)?.get(key(request))?.clone(),
    delete: async (name: string) => stores.delete(name),
    keys: async () => [...stores.keys()],
  };
}

function load(fetchImpl: (request: unknown) => Promise<Response>, caches = fakeCaches()) {
  const listeners = new Map<string, (event: any) => void>();
  const self = { location: { origin: 'https://notes.test' }, addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler), clients: { claim: vi.fn() } };
  const sw = new Function('self', 'caches', 'fetch', `${source}; return { strategyFor, navigate, api };`)(self, caches, fetchImpl);
  sw.request = (request: unknown) => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request, respondWith: (value: Promise<Response>) => { response = value; } });
    return response || fetchImpl(request);
  };
  sw.activate = () => new Promise<void>((resolve, reject) => {
    listeners.get('activate')!({ waitUntil: (work: Promise<void>) => work.then(resolve, reject) });
  });
  sw.clear = () => new Promise<void>((resolve, reject) => {
    listeners.get('message')!({
      data: { type: 'CLEAR_OFFLINE_DATA' },
      ports: [{ postMessage: ({ ok }: { ok: boolean }) => ok ? resolve() : reject(new Error('clear failed')) }],
      waitUntil: () => {},
    });
  });
  return { sw, caches };
}

const get = (path: string, mode = 'cors') => ({ url: 'https://notes.test' + path, method: 'GET', mode });
const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });
const post = (path: string) => ({ ...get(path), method: 'POST' });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const dataCache = 'meemo-data-v2';
const cachedNotes = (caches: ReturnType<typeof fakeCaches>) => caches.match(get('/api/things'), { cacheName: dataCache });

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
    expect(await caches.keys()).not.toContain('meemo-data-v2');
  });

  it('does not recreate the private cache when an old 200 arrives after a 401', async () => {
    const old = deferred<Response>();
    const fetchImpl = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);
    const pending = sw.request(get('/api/things'));
    await sw.request(get('/api/settings'));
    expect(await caches.keys()).not.toContain(dataCache);
    old.resolve(new Response('synthetic account A'));
    await pending;
    expect(await caches.keys()).not.toContain(dataCache);
  });

  it.each([false, true])('invalidates at logout even when offline=%s and ignores old responses', async (offline) => {
    const old = deferred<Response>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A')).mockReturnValueOnce(old.promise);
    if (offline) fetchImpl.mockRejectedValueOnce(new TypeError('offline'));
    else fetchImpl.mockResolvedValueOnce(new Response('{}'));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    const pending = sw.request(get('/api/things'));
    const logout = sw.request(post('/api/logout'));
    if (offline) await expect(logout).rejects.toThrow('offline');
    else await logout;
    expect(await cachedNotes(caches)).toBeUndefined();
    old.resolve(new Response('late synthetic account A'));
    await pending;
    expect(await cachedNotes(caches)).toBeUndefined();
  });

  it.each(['same-account', 'other-account'])('keeps fresh %s login data despite late old 200/401 responses', async (account) => {
    const oldOK = deferred<Response>();
    const old401 = deferred<Response>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A'))
      .mockReturnValueOnce(oldOK.promise).mockReturnValueOnce(old401.promise)
      .mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response(`synthetic ${account}`))
      .mockRejectedValueOnce(new TypeError('offline'));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    const a = sw.request(get('/api/things'));
    const b = sw.request(get('/api/settings'));
    await sw.request(post('/api/login'));
    expect(await cachedNotes(caches)).toBeUndefined();
    await sw.request(get('/api/things'));
    oldOK.resolve(new Response('late synthetic account A'));
    old401.resolve(new Response('{}', { status: 401 }));
    await Promise.all([a, b]);
    expect(await (await cachedNotes(caches))!.text()).toBe(`synthetic ${account}`);
    expect(await (await sw.request(get('/api/things'))).text()).toBe(`synthetic ${account}`);
  });

  it('does not save or serve reads made during login with old cookies', async () => {
    const login = deferred<Response>();
    const entered = deferred<void>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A'))
      .mockImplementationOnce(() => { entered.resolve(); return login.promise; }).mockResolvedValueOnce(new Response('old cookie response'))
      .mockRejectedValueOnce(new TypeError('offline'));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    const pending = sw.request(post('/api/login'));
    await entered.promise;
    await sw.request(get('/api/things'));
    expect(await cachedNotes(caches)).toBeUndefined();
    await expect(sw.request(get('/api/things'))).rejects.toThrow();
    login.resolve(new Response('{}'));
    await pending;
    expect(await cachedNotes(caches)).toBeUndefined();
  });

  it.each([post('/api/things'), post('/api/files'), get('/api/mcp/connections')])('clears on a non-cacheable 401: $url $method', async (request) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    expect((await sw.request(request)).status).toBe(401);
    expect(await cachedNotes(caches)).toBeUndefined();
  });

  it('waits for an in-flight cache put before finishing invalidation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);
    const open = caches.open.bind(caches);
    vi.spyOn(caches, 'open').mockImplementationOnce(async (name) => {
      const cache = await open(name);
      return { ...cache, put: async (request, response) => { entered.resolve(); await release.promise; await cache.put(request, response); } };
    });
    const pending = sw.request(get('/api/things'));
    await entered.promise;
    const invalidation = sw.request(get('/api/settings'));
    release.resolve();
    await Promise.all([pending, invalidation]);
    expect(await caches.keys()).not.toContain(dataCache);
  });

  it('does not recreate a cache when caches.open finishes after invalidation', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);
    const open = caches.open.bind(caches);
    vi.spyOn(caches, 'open').mockImplementationOnce(async (name) => { entered.resolve(); await release.promise; return open(name); });
    const pending = sw.request(get('/api/things'));
    await entered.promise;
    const invalidation = sw.request(get('/api/settings'));
    release.resolve();
    await Promise.all([pending, invalidation]);
    expect(await caches.keys()).not.toContain(dataCache);
  });

  it('rejects an old failed fetch instead of falling back to the new account cache', async () => {
    const old = deferred<Response>();
    const fetchImpl = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('synthetic account B'));
    const { sw } = load(fetchImpl);
    const pending = sw.request(get('/api/things'));
    const rejected = expect(pending).rejects.toThrow('offline');
    await sw.request(post('/api/login'));
    await sw.request(get('/api/things'));
    old.reject(new TypeError('offline'));
    await rejected;
  });

  it('does not return an offline cache match resolved after session invalidation', async () => {
    const matched = deferred<void>();
    const release = deferred<void>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A'))
      .mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(new Response('{}', { status: 401 }));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    const match = caches.match.bind(caches);
    vi.spyOn(caches, 'match').mockImplementationOnce(async (request, options) => {
      const result = await match(request, options);
      matched.resolve();
      await release.promise;
      return result;
    });
    const pending = sw.request(get('/api/things'));
    const rejected = expect(pending).rejects.toThrow('offline');
    await matched.promise;
    const invalidation = sw.request(get('/api/settings'));
    release.resolve();
    await Promise.all([rejected, invalidation]);
  });

  it('acknowledges page cleanup only after deletion and fences old responses', async () => {
    const old = deferred<Response>();
    const entered = deferred<void>();
    const release = deferred<void>();
    const { sw, caches } = load(vi.fn().mockResolvedValueOnce(new Response('synthetic account A')).mockReturnValueOnce(old.promise));
    await sw.request(get('/api/things'));
    const pending = sw.request(get('/api/things'));
    const remove = caches.delete.bind(caches);
    vi.spyOn(caches, 'delete').mockImplementationOnce(async (name) => { entered.resolve(); await release.promise; return remove(name); });
    let acknowledged = false;
    const clearing = sw.clear().then(() => { acknowledged = true; });
    await entered.promise;
    expect(acknowledged).toBe(false);
    release.resolve();
    await clearing;
    expect(await cachedNotes(caches)).toBeUndefined();
    old.resolve(new Response('late synthetic account A'));
    await pending;
    expect(await caches.keys()).not.toContain(dataCache);
  });

  it('queues a new-session write behind a pending cache deletion', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })).mockResolvedValueOnce(new Response('synthetic account B'));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    const remove = caches.delete.bind(caches);
    vi.spyOn(caches, 'delete').mockImplementationOnce(async (name) => { entered.resolve(); await release.promise; return remove(name); });
    const invalidation = sw.request(get('/api/settings'));
    await entered.promise;
    const fresh = sw.request(get('/api/things'));
    release.resolve();
    await Promise.all([invalidation, fresh]);
    expect(await (await cachedNotes(caches))!.text()).toBe('synthetic account B');
  });

  it('keeps caching disabled until all overlapping auth transitions finish', async () => {
    const login = deferred<Response>();
    const logout = deferred<Response>();
    const loginEntered = deferred<void>();
    const logoutEntered = deferred<void>();
    const fetchImpl = vi.fn((request: unknown) => {
      const path = new URL((request as { url: string }).url).pathname;
      if (path === '/api/login') { loginEntered.resolve(); return login.promise; }
      if (path === '/api/logout') { logoutEntered.resolve(); return logout.promise; }
      return Promise.resolve(new Response('synthetic read'));
    });
    const { sw, caches } = load(fetchImpl);
    const a = sw.request(post('/api/login'));
    const b = sw.request(post('/api/logout'));
    await Promise.all([loginEntered.promise, logoutEntered.promise]);
    login.resolve(new Response('{}'));
    await a;
    await sw.request(get('/api/things'));
    expect(await cachedNotes(caches)).toBeUndefined();
    logout.resolve(new Response('{}'));
    await b;
    await sw.request(get('/api/things'));
    expect(await (await cachedNotes(caches))!.text()).toBe('synthetic read');
  });

  it('returns the real 401 and disables offline data after deletion fails, then recovers on clear', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('synthetic account A'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })).mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('uncached')).mockResolvedValueOnce(new Response('fresh'));
    const { sw, caches } = load(fetchImpl);
    await sw.request(get('/api/things'));
    vi.spyOn(caches, 'delete').mockRejectedValueOnce(new Error('storage failed'));
    expect((await sw.request(get('/api/things'))).status).toBe(401);
    await expect(sw.request(get('/api/things'))).rejects.toThrow('offline');
    expect(await (await sw.request(get('/api/things'))).text()).toBe('uncached');
    expect(await (await cachedNotes(caches))!.text()).toBe('synthetic account A');
    await sw.clear();
    await sw.request(get('/api/things'));
    expect(await (await cachedNotes(caches))!.text()).toBe('fresh');
  });

  it('retires the vulnerable cache and never reads a late pre-fix worker write', async () => {
    const { sw, caches } = load(vi.fn().mockRejectedValue(new TypeError('offline')));
    const shell = await caches.open('meemo-shell-v1');
    await shell.put('/', html('cached shell'));
    await (await caches.open('meemo-data-v1')).put(get('/api/things'), new Response('synthetic A'));
    await sw.activate();
    expect(await caches.keys()).not.toContain('meemo-data-v1');
    await (await caches.open('meemo-data-v1')).put(get('/api/things'), new Response('late old-worker A'));
    await expect(sw.request(get('/api/things'))).rejects.toThrow('offline');
    expect(await (await shell.match('/'))!.text()).toBe('cached shell');
  });

  it('does not revive retained private data after a failed deletion and worker restart', async () => {
    const first = load(vi.fn().mockResolvedValueOnce(new Response('{"user":{"id":"synthetic-A"}}'))
      .mockResolvedValueOnce(new Response('{}', { status: 401 })));
    await first.sw.request(get('/api/profile'));
    vi.spyOn(first.caches, 'delete').mockRejectedValueOnce(new Error('storage failed'));
    expect((await first.sw.request(get('/api/settings'))).status).toBe(401);
    const restarted = load(vi.fn().mockRejectedValue(new TypeError('offline')), first.caches);
    await expect(restarted.sw.request(get('/api/profile'))).rejects.toThrow('offline');
    await restarted.sw.clear();
    expect(await first.caches.keys()).not.toContain(dataCache);
  });

  it.each(['open', 'put'])('still erases data when writing the persistent fence fails at %s', async (failure) => {
    const first = load(vi.fn().mockResolvedValue(new Response('synthetic A')));
    await first.sw.request(get('/api/things'));
    if (failure === 'open') vi.spyOn(first.caches, 'open').mockRejectedValueOnce(new Error('storage failed'));
    else {
      const shell = await first.caches.open('meemo-shell-v1');
      vi.spyOn(first.caches, 'open').mockResolvedValueOnce({ ...shell, put: vi.fn().mockRejectedValue(new Error('storage failed')) });
    }
    await expect(first.sw.clear()).rejects.toThrow('clear failed');
    const restarted = load(vi.fn().mockRejectedValue(new TypeError('offline')), first.caches);
    await expect(restarted.sw.request(get('/api/things'))).rejects.toThrow('offline');
  });

  it('keeps a failed tombstone removal fenced across restart until a successful clear', async () => {
    const first = load(vi.fn().mockResolvedValue(new Response('synthetic A')));
    await first.sw.request(get('/api/things'));
    const shell = await first.caches.open('meemo-shell-v1');
    vi.spyOn(first.caches, 'open').mockResolvedValueOnce({ ...shell, delete: vi.fn().mockRejectedValue(new Error('storage failed')) });
    await expect(first.sw.clear()).rejects.toThrow('clear failed');
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('uncached')).mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(new Response('fresh'));
    const restarted = load(fetchImpl, first.caches);
    await restarted.sw.request(get('/api/things'));
    expect(await cachedNotes(first.caches)).toBeUndefined();
    await expect(restarted.sw.request(get('/api/things'))).rejects.toThrow('offline');
    await restarted.sw.clear();
    await restarted.sw.request(get('/api/things'));
    expect(await (await cachedNotes(first.caches))!.text()).toBe('fresh');
  });

  it('preserves ordinary offline reading across worker restarts', async () => {
    const first = load(vi.fn().mockResolvedValue(new Response('synthetic account A')));
    await first.sw.request(get('/api/things'));
    const restarted = load(vi.fn().mockRejectedValue(new TypeError('offline')), first.caches);
    expect(await (await restarted.sw.request(get('/api/things'))).text()).toBe('synthetic account A');
  });

  it('reports failed page cleanup instead of acknowledging it', async () => {
    const { sw, caches } = load(vi.fn());
    vi.spyOn(caches, 'delete').mockRejectedValueOnce(new Error('storage failed'));
    await expect(sw.clear()).rejects.toThrow('clear failed');
    await expect(sw.clear()).resolves.toBeUndefined();
  });

  it.each(['open', 'put'])('returns fresh network data when cache %s fails', async (failure) => {
    const { sw, caches } = load(vi.fn().mockResolvedValueOnce(new Response('old')).mockResolvedValueOnce(new Response('fresh')));
    await sw.request(get('/api/things'));
    if (failure === 'open') vi.spyOn(caches, 'open').mockRejectedValueOnce(new Error('quota'));
    else vi.spyOn(caches, 'open').mockResolvedValueOnce({ match: vi.fn(), put: vi.fn().mockRejectedValue(new Error('quota')), delete: vi.fn() });
    expect(await (await sw.request(get('/api/things'))).text()).toBe('fresh');
  });

  it.each([post('/api/things'), post('/api/files'), get('/api/mcp/connections'), get('/api/files/u/t/private.jpg')])('never caches bypassed successful requests: $url $method', async (request) => {
    const { sw, caches } = load(vi.fn().mockResolvedValue(new Response('synthetic private response')));
    await sw.request(request);
    expect(await caches.keys()).not.toContain(dataCache);
  });

  it('updates current-session cached reads and preserves query-specific offline responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('v1')).mockResolvedValueOnce(new Response('v2'))
      .mockResolvedValueOnce(new Response('page2')).mockRejectedValue(new TypeError('offline'));
    const { sw } = load(fetchImpl);
    await sw.request(get('/api/things'));
    await sw.request(get('/api/things'));
    await sw.request(get('/api/things?skip=10'));
    expect(await (await sw.request(get('/api/things'))).text()).toBe('v2');
    expect(await (await sw.request(get('/api/things?skip=10'))).text()).toBe('page2');
  });
});
