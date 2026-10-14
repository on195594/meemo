import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App.vue';
import type { Thing } from '../api/client';
import { useAuth } from '../composables/useAuth';
import NotesView from './NotesView.vue';

const NOTE: Thing = {
  _id: 'note-1',
  ownerId: 'user-a',
  content: 'Synthetic note #work',
  richContent: '',
  attachments: [],
  tags: ['work'],
  public: false,
  shared: false,
  archived: false,
  sticky: false,
  createdAt: 1,
  modifiedAt: 1,
  revision: 1,
};

function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  } as Response;
}

function backend(settings: Record<string, unknown> = {}) {
  const state = { deleted: false };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method || 'GET';
    if (url === '/api/profile') return json({ user: { id: 'user-a', username: 'alice', displayName: 'Alice' } });
    if (url === '/api/settings') return json({ settings });
    if (url === '/api/tags') return json({ tags: [{ name: 'zeta', usage: 9 }, { name: 'work', usage: 1 }] });
    if (url.startsWith('/api/things?')) return json({ things: state.deleted ? [] : [NOTE] });
    if (url === '/api/things/note-1' && method === 'DELETE') {
      state.deleted = true;
      return json({});
    }
    if (url === '/api/things/note-1/restore' && method === 'POST') {
      state.deleted = false;
      return json({ thing: { ...NOTE, revision: 3 } });
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
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: NotesView }] });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body });
  await settle();
  return { wrapper, router };
}

describe('Keep-style notes workspace', () => {
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

  it('lists labels alphabetically in the sidebar and filters by them', async () => {
    const { fetchMock } = backend();
    const rendered = await renderApp(fetchMock);
    wrapper = rendered.wrapper;

    const labels = wrapper.findAll('.sidebar-item').map((item) => item.text());
    expect(labels).toEqual(['Notes', 'work', 'zeta', 'Archive', 'Trash']);

    await wrapper.findAll('.sidebar-item')[1].trigger('click');
    await settle();
    expect(rendered.router.currentRoute.value.query).toEqual({ tag: 'work' });
    expect(wrapper.get('.sidebar-item.active').text()).toBe('work');
  });

  it('hides labels when the tag sidebar setting is off', async () => {
    const { fetchMock } = backend({ showTagSidebar: false });
    wrapper = (await renderApp(fetchMock)).wrapper;

    expect(wrapper.findAll('.sidebar-item').map((item) => item.text())).toEqual(['Notes', 'Archive', 'Trash']);
  });

  it('moves a note to Trash without confirmation and restores it from the snackbar Undo', async () => {
    const { fetchMock } = backend();
    wrapper = (await renderApp(fetchMock)).wrapper;

    await wrapper.get('.note-card [aria-label="Delete note"]').trigger('click');
    await settle();
    expect(wrapper.find('.note-card').exists()).toBe(false);
    expect(wrapper.get('.snackbar').text()).toContain('Note moved to Trash');

    await wrapper.get('.snackbar-action').trigger('click');
    await settle();

    const restore = fetchMock.mock.calls.find(([url]) => url === '/api/things/note-1/restore');
    expect(JSON.parse(String(restore?.[1]?.body))).toEqual({ expectedRevision: 2 });
    expect(wrapper.find('.note-card').exists()).toBe(true);
    expect(wrapper.find('.snackbar').exists()).toBe(false);
  });
});
