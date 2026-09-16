import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import type { Thing, UserProfile } from './api/client';
import { useAuth } from './composables/useAuth';
import { useNotes } from './composables/useNotes';
import NotesView from './views/NotesView.vue';

const accounts: Record<'a' | 'b', UserProfile> = {
  a: { id: 'user-a', username: 'alice', displayName: 'Alice', email: 'alice@example.com' },
  b: { id: 'user-b', username: 'bob', displayName: 'Bob', email: 'bob@example.com' },
};

function note(owner: 'a' | 'b'): Thing {
  return {
    _id: `note-${owner}`,
    ownerId: `user-${owner}`,
    content: `${owner.toUpperCase()} private note`,
    richContent: '',
    attachments: [],
    tags: [],
    public: false,
    shared: false,
    archived: false,
    sticky: false,
    createdAt: 1,
    modifiedAt: 1,
  };
}

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function backend() {
  const state: { current: 'a' | 'b' | null; rejectNextThings: boolean } = {
    current: 'a',
    rejectNextThings: false,
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method || 'GET';

    if (url === '/api/login' && method === 'POST') {
      state.current = 'b';
      return json({});
    }
    if (url === '/api/logout' && method === 'POST') {
      state.current = null;
      return json({});
    }
    if (url === '/api/profile') {
      return state.current
        ? json({ user: accounts[state.current] })
        : json({ code: 'authentication_required', message: 'Log in' }, 401);
    }
    if (url.startsWith('/api/things?')) {
      if (state.rejectNextThings) {
        state.rejectNextThings = false;
        return json({ code: 'authentication_required', message: 'Expired' }, 401);
      }
      return json({ things: state.current ? [note(state.current)] : [] });
    }
    if (url === '/api/tags') return json({ tags: [] });
    if (url === '/api/settings') return json({ settings: { showTagSidebar: false } });
    if (url === '/api/users') {
      return json({ users: Object.values(accounts).map(({ username, displayName }) => ({ username, displayName })) });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });

  return { state, fetchMock };
}

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

async function renderApp(fetchMock: ReturnType<typeof backend>['fetchMock']) {
  vi.stubGlobal('fetch', fetchMock);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: NotesView },
      { path: '/public/:userId', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] } });
  await settle();
  return { wrapper, router };
}

describe('App authenticated note flows', () => {
  let wrapper: VueWrapper | undefined;

  beforeEach(() => {
    useAuth()._resetState();
    localStorage.clear();
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.unstubAllGlobals();
  });

  it('reloads NotesView when header search changes the route query', async () => {
    const { fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;
    fetchMock.mockClear();

    const input = wrapper.get('.header-search-input');
    await input.setValue('needle');
    await input.trigger('keydown', { key: 'Enter' });
    await settle();

    expect(rendered.router.currentRoute.value.query.q).toBe('needle');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/things?filter=needle&archived=false&skip=0&limit=15',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
  });

  it('expires the session and clears auth and note state after a component request returns 401', async () => {
    const { state, fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;
    expect(wrapper.text()).toContain('A private note');
    expect(localStorage.getItem('meemo_has_session')).toBe('1');

    state.rejectNextThings = true;
    await wrapper.get('.user-profile-btn').trigger('click');
    const archiveBtn = wrapper.findAll('.dropdown-item').find((w) => w.text().includes('Archived'))!;
    await archiveBtn.trigger('click');
    await settle();

    expect(useAuth().user.value).toBeNull();
    expect(useAuth().sessionExpired.value).toBe(true);
    expect(useNotes().things.value).toEqual([]);
    expect(localStorage.getItem('meemo_has_session')).toBeNull();
    expect(wrapper.get('.session-expired-banner').text()).toContain('Your session has expired');
    expect(wrapper.text()).not.toContain('A private note');
  });

  it('does not retain user A notes after logout and user B login', async () => {
    const { state, fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;
    expect(wrapper.text()).toContain('A private note');

    await wrapper.get('.user-profile-btn').trigger('click');
    await wrapper.get('.logout-btn').trigger('click');
    await settle();

    expect(state.current).toBeNull();
    expect(useNotes().things.value).toEqual([]);
    expect(wrapper.text()).not.toContain('A private note');

    await wrapper.get('.login-btn').trigger('click');
    await wrapper.get('#login-username').setValue('bob');
    await wrapper.get('#login-password').setValue('password');
    await wrapper.get('.auth-form').trigger('submit');
    await settle();

    expect(useAuth().user.value?.id).toBe('user-b');
    expect(wrapper.get('.user-profile-btn').text()).toContain('Bob');
    expect(wrapper.text()).toContain('B private note');
    expect(wrapper.text()).not.toContain('A private note');
  });

  it('cycles theme between auto, dark, and light and updates document theme attribute', async () => {
    const { fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;

    const themeBtn = wrapper.get('.theme-toggle-btn');
    expect(themeBtn.text()).toContain('Auto');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    await themeBtn.trigger('click');
    await settle();
    expect(themeBtn.text()).toContain('Dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('meemo_theme')).toBe('dark');

    await themeBtn.trigger('click');
    await settle();
    expect(themeBtn.text()).toContain('Light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('meemo_theme')).toBe('light');

    await themeBtn.trigger('click');
    await settle();
    expect(themeBtn.text()).toContain('Auto');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(localStorage.getItem('meemo_theme')).toBe('auto');
  });

  it('renders notes inside a masonry layout', async () => {
    const { fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;

    expect(wrapper.find('.m3-notes-masonry').exists()).toBe(true);
    expect(wrapper.find('.note-card').exists()).toBe(true);
  });
});
