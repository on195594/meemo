import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../api/client';
import { useAuth } from './useAuth';
import { clearOfflineData } from '../utils/pwa';

vi.mock('../utils/pwa', () => ({ clearOfflineData: vi.fn(async () => {}) }));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

const alice = { id: 'synthetic-a', username: 'alice', displayName: 'Alice', email: 'alice@example.test' };
const bob = { id: 'synthetic-b', username: 'bob', displayName: 'Bob', email: 'bob@example.test' };

describe('auth offline cache coordination', () => {
  beforeEach(() => {
    useAuth()._resetState();
    localStorage.clear();
    vi.mocked(clearOfflineData).mockReset().mockResolvedValue();
    vi.spyOn(api.auth, 'profile').mockResolvedValue({ user: alice });
    vi.spyOn(api.auth, 'login').mockResolvedValue({ user: bob });
    vi.spyOn(api.auth, 'logout').mockResolvedValue({});
    vi.spyOn(api.public, 'users').mockResolvedValue({ users: [] });
  });
  afterEach(() => vi.restoreAllMocks());

  it('waits for old cache cleanup before sending login and before exposing the new user', async () => {
    const before = deferred();
    const after = deferred();
    const entered = deferred();
    vi.mocked(clearOfflineData).mockReturnValueOnce(before.promise).mockImplementationOnce(() => { entered.resolve(); return after.promise; });
    const auth = useAuth();
    const login = auth.login('bob', 'synthetic-password');
    expect(api.auth.login).not.toHaveBeenCalled();
    before.resolve();
    await entered.promise;
    expect(api.auth.login).toHaveBeenCalledOnce();
    expect(auth.user.value).toBeNull();
    after.resolve();
    expect(await login).toEqual({ success: true });
    expect(auth.user.value?.id).toBe(bob.id);
  });

  it('finishes logout cleanup before a concurrent login can start', async () => {
    const clearing = deferred();
    const entered = deferred();
    const auth = useAuth();
    await auth.init();
    vi.mocked(clearOfflineData).mockImplementationOnce(() => { entered.resolve(); return clearing.promise; });
    const logout = auth.logout();
    const login = auth.login('bob', 'synthetic-password');
    await entered.promise;
    expect(api.auth.login).not.toHaveBeenCalled();
    clearing.resolve();
    await Promise.all([logout, login]);
    expect(auth.user.value?.id).toBe(bob.id);
    expect(auth.isAuthenticated.value).toBe(true);
    expect(localStorage.getItem('meemo_has_session')).toBe('1');
  });

  it('still logs out remotely and resets local auth if cache cleanup fails', async () => {
    const auth = useAuth();
    await auth.init();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(clearOfflineData).mockRejectedValue(new Error('Cache clear failed'));
    await auth.logout();
    expect(api.auth.logout).toHaveBeenCalledOnce();
    expect(auth.user.value).toBeNull();
    expect(localStorage.getItem('meemo_has_session')).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('does not publish a login when the cache clear cannot be acknowledged', async () => {
    vi.mocked(clearOfflineData).mockRejectedValueOnce(new Error('Cache clear failed'));
    expect(await useAuth().login('bob', 'synthetic-password')).toEqual({ success: false, error: 'Cache clear failed' });
    expect(api.auth.login).not.toHaveBeenCalled();
    expect(useAuth().user.value).toBeNull();
  });
});
