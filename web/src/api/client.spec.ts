import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { api as Api, UnauthorizedHandler } from './client';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const errorBody = { code: 'session_expired', message: 'Session expired' };
const unauthorized = () => new Response(JSON.stringify(errorBody), { status: 401 });
const success = () => new Response('{}', { status: 200 });

class FakeXHR {
  static latest: FakeXHR;
  status = 401;
  statusText = 'Unauthorized';
  responseText = JSON.stringify(errorBody);
  withCredentials = false;
  upload = {};
  onload?: () => void;
  onerror?: () => void;
  open = vi.fn();
  send = vi.fn();
  constructor() { FakeXHR.latest = this; }
}

describe('API unauthorized generation', () => {
  let api: typeof Api;
  let handler: ReturnType<typeof vi.fn<UnauthorizedHandler>>;
  let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(async () => {
    vi.resetModules();
    fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('XMLHttpRequest', FakeXHR);
    const client = await import('./client');
    api = client.api;
    handler = vi.fn();
    client.onUnauthorized(handler);
  });

  afterEach(() => vi.unstubAllGlobals());

  async function pendingUnauthorized(transport: string) {
    let finish: () => void;
    let request: Promise<unknown>;
    let path: string;
    if (transport === 'fetch network' || transport === 'fetch JSON') {
      path = '/api/profile';
      if (transport === 'fetch network') {
        const network = deferred<Response>();
        fetchMock.mockReturnValueOnce(network.promise);
        finish = () => network.resolve(unauthorized());
      } else {
        const body = deferred<typeof errorBody>();
        const response = unauthorized();
        vi.spyOn(response, 'json').mockReturnValueOnce(body.promise);
        fetchMock.mockResolvedValueOnce(response);
        finish = () => body.resolve(errorBody);
      }
      request = api.auth.profile();
    } else {
      path = transport === 'upload' ? '/api/files' : '/api/import';
      const file = new File(['archive'], 'archive.tar');
      request = transport === 'upload' ? api.files.upload(file) : api.transfer.importArchive(file);
      const xhr = FakeXHR.latest;
      finish = () => xhr.onload!();
    }
    const result = request.catch(error => error);
    await Promise.resolve(); // Let fetch reach a pending JSON body before changing auth.
    return { finish, result, path };
  }

  for (const transport of ['fetch network', 'fetch JSON', 'upload', 'import']) {
    it(`${transport}: current-generation 401 still notifies and rejects`, async () => {
      const pending = await pendingUnauthorized(transport);
      pending.finish();
      const error = await pending.result;
      expect(error).toMatchObject({ name: 'ApiError', status: 401, ...errorBody });
      expect(handler).toHaveBeenCalledExactlyOnceWith(pending.path, error);
    });

    for (const action of ['login', 'logout'] as const) {
      for (const boundary of ['start', 'success', 'HTTP failure', 'network failure']) {
        it(`${transport}: ignores stale 401 at ${action} ${boundary}`, async () => {
          let pending = boundary === 'start' ? await pendingUnauthorized(transport) : undefined;
          const authNetwork = deferred<Response>();
          fetchMock.mockReturnValueOnce(authNetwork.promise);
          const authRequest = action === 'login' ? api.auth.login('alice', 'password') : api.auth.logout();
          const authResult = authRequest.catch(error => error);
          pending ??= await pendingUnauthorized(transport);

          if (boundary !== 'start') {
            if (boundary === 'network failure') authNetwork.reject(new Error('offline'));
            else authNetwork.resolve(boundary === 'HTTP failure'
              ? new Response('{}', { status: 500 }) : success());
            await authResult;
          }
          pending.finish();
          expect(await pending.result).toMatchObject({ name: 'ApiError', status: 401, ...errorBody });
          expect(handler).not.toHaveBeenCalled();
          if (boundary === 'start') {
            authNetwork.resolve(success());
            await authResult;
          }

          // New requests must still expire the current session after the boundary.
          fetchMock.mockResolvedValueOnce(unauthorized());
          await expect(api.auth.profile()).rejects.toMatchObject({ status: 401 });
          expect(handler).toHaveBeenCalledTimes(1);
        });
      }
    }
  }

  it('does not notify for failed login or registration', async () => {
    fetchMock.mockImplementation(async () => unauthorized());
    await expect(api.auth.login('alice', 'wrong')).rejects.toMatchObject({ status: 401, ...errorBody });
    await expect(api.auth.register({ username: 'alice', password: 'wrong', email: '', displayName: 'Alice' }))
      .rejects.toMatchObject({ status: 401, ...errorBody });
    expect(handler).not.toHaveBeenCalled();
  });

  it('preserves login/logout request options and successful response shapes', async () => {
    const loginBody = { user: { id: 'alice' } };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(loginBody)))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    expect(await api.auth.login('alice', 'password')).toEqual(loginBody);
    expect(await api.auth.logout()).toEqual({});
    expect(fetchMock.mock.calls.map(([path, options]) => ({
      path, method: options?.method, credentials: options?.credentials,
      contentType: new Headers(options?.headers).get('Content-Type'), body: options?.body,
    }))).toEqual([
      { path: '/api/login', method: 'POST', credentials: 'same-origin', contentType: 'application/json', body: JSON.stringify({ username: 'alice', password: 'password' }) },
      { path: '/api/logout', method: 'POST', credentials: 'same-origin', contentType: 'application/json', body: undefined },
    ]);
  });
});
