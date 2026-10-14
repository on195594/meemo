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
  const state = { deleted: false, archived: false, failDelete: false, content: NOTE.content, revision: NOTE.revision };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = init?.method || 'GET';
    if (url === '/api/profile') return json({ user: { id: 'user-a', username: 'alice', displayName: 'Alice' } });
    if (url === '/api/settings') return json({ settings });
    if (url === '/api/tags') return json({ tags: [{ name: 'zeta', usage: 9 }, { name: 'work', usage: 1 }] });
    if (url.startsWith('/api/things?')) {
      const wantsArchived = url.includes('archived=true');
      return json({ things: state.deleted || state.archived !== wantsArchived ? [] : [{ ...NOTE, ...state }] });
    }
    if (url === '/api/things/note-1' && method === 'DELETE') {
      if (state.failDelete) return json({ code: 'revision_conflict', message: 'Changed elsewhere' }, 409);
      state.deleted = true;
      state.revision++;
      return json({});
    }
    if (url === '/api/things/note-1' && method === 'PUT') {
      const body = JSON.parse(String(init?.body));
      state.archived = body.archived;
      state.content = body.content;
      state.revision = body.expectedRevision + 1;
      return json({ thing: { ...NOTE, ...state } });
    }
    if (url === '/api/things/note-1/restore' && method === 'POST') {
      state.deleted = false;
      state.revision++;
      return json({ thing: { ...NOTE, ...state } });
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

async function dialogAction(action: string) {
  if (action === 'Move note to trash') {
    (document.querySelector('.note-modal-card [aria-label="More note actions"]') as HTMLButtonElement).click();
    await settle();
  }
  const owner = action === 'Move note to trash' ? '[role="menu"]' : '.note-modal-card';
  return document.querySelector(`${owner} [aria-label="${action}"]`) as HTMLButtonElement;
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

    await wrapper.get('.note-card [aria-label="More note actions"]').trigger('click');
    await settle();
    (document.querySelector('[role="menu"] [aria-label="Delete note"]') as HTMLButtonElement).click();
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

  it('undoes an archive from the snackbar', async () => {
    const { fetchMock, state } = backend();
    wrapper = (await renderApp(fetchMock)).wrapper;

    await wrapper.get('.note-card [aria-label="Archive note"]').trigger('click');
    await settle();
    expect(state.archived).toBe(true);
    expect(wrapper.find('.note-card').exists()).toBe(false);

    await wrapper.get('.snackbar-action').trigger('click');
    await settle();
    expect(state.archived).toBe(false);
    expect(wrapper.find('.note-card').exists()).toBe(true);
  });

  it.each(['Archive note', 'Move note to trash'])('saves a dialog draft before %s and Undo restores that draft', async (action) => {
    const { fetchMock, state } = backend();
    wrapper = (await renderApp(fetchMock)).wrapper;
    await wrapper.get('.note-card .card-body').trigger('click');
    await settle();
    const body = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    body.value = 'Draft preserved through Undo';
    body.dispatchEvent(new Event('input'));
    (await dialogAction(action)).click();
    await settle();

    expect(state.content).toBe('Draft preserved through Undo');
    expect(document.querySelector('.note-modal-overlay')).toBeNull();
    expect(wrapper.find('.note-card').exists()).toBe(false);
    await wrapper.get('.snackbar-action').trigger('click');
    await settle();
    expect(wrapper.get('.note-card').text()).toContain('Draft preserved through Undo');
    const writes = fetchMock.mock.calls.filter(([, init]) => init?.method);
    expect(writes).toHaveLength(3);
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({ content: state.content, expectedRevision: 1 });
    expect(JSON.parse(String(writes[1][1]?.body))).toMatchObject({ expectedRevision: 2 });
    expect(JSON.parse(String(writes[2][1]?.body))).toMatchObject({ expectedRevision: 3 });
  });

  it.each(['Archive note', 'Move note to trash'])('locks the dialog during a delayed %s instead of losing subsequent edits', async (action) => {
    const { fetchMock } = backend();
    const respond = fetchMock.getMockImplementation()!;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    fetchMock.mockImplementation(async (input, init) => {
      if (init?.method === 'DELETE' || (init?.method === 'PUT' && JSON.parse(String(init.body)).archived)) await pending;
      return respond(input, init);
    });
    wrapper = (await renderApp(fetchMock)).wrapper;
    await wrapper.get('.note-card .card-body').trigger('click');
    await settle();
    const body = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    body.value = 'Draft before delayed action';
    body.dispatchEvent(new Event('input'));
    const button = await dialogAction(action);
    button.click();
    await settle();

    expect(body.disabled).toBe(true);
    const lockedControl = document.querySelector(`.note-modal-card [aria-label="${action === 'Move note to trash' ? 'More note actions' : action}"]`) as HTMLButtonElement;
    expect(lockedControl.disabled).toBe(true);
    lockedControl.click();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(document.querySelector('.note-modal-overlay')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method)).toHaveLength(2);

    release();
    await settle();
    expect(document.querySelector('.note-modal-overlay')).toBeNull();
    await wrapper.get('.snackbar-action').trigger('click');
    await settle();
    expect(wrapper.get('.note-card').text()).toContain('Draft before delayed action');
  });

  it('keeps the note dialog and its draft open when deleting fails', async () => {
    const { fetchMock, state } = backend();
    state.failDelete = true;
    wrapper = (await renderApp(fetchMock)).wrapper;

    await wrapper.get('.note-card .card-body').trigger('click');
    await settle();
    const body = document.querySelector('.modal-textarea') as HTMLTextAreaElement;
    body.value = 'Unsaved edit';
    body.dispatchEvent(new Event('input'));
    (await dialogAction('Move note to trash')).click();
    await settle();

    expect(document.querySelector('.note-modal-overlay')).not.toBeNull();
    expect((document.querySelector('.modal-textarea') as HTMLTextAreaElement).value).toBe('Unsaved edit');
    expect(wrapper.get('.snackbar').text()).toContain('This note changed elsewhere');
  });

  it('moves focus into the mobile drawer, traps Tab, and returns focus on Escape', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const { fetchMock } = backend();
    wrapper = (await renderApp(fetchMock)).wrapper;

    const menu = wrapper.get('.menu-btn');
    await menu.trigger('click');
    await settle();
    const items = wrapper.findAll('.sidebar-item');
    expect(document.activeElement).toBe(items[0].element);

    (items[items.length - 1].element as HTMLElement).focus();
    await items[items.length - 1].trigger('keydown', { key: 'Tab' });
    expect(document.activeElement).toBe(items[0].element);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(wrapper.find('.app-sidebar-slot.mobile-open').exists()).toBe(false);
    expect(document.activeElement).toBe(menu.element);
  });
});
