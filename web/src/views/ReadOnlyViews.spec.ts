import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { router as applicationRouter } from '../router';
import NoteCard from '../components/NoteCard.vue';

const mocks = vi.hoisted(() => ({ get: vi.fn(), listThings: vi.fn(), getThing: vi.fn(), userProfile: vi.fn() }));
vi.mock('../api/client', () => ({ api: { things: { get: mocks.get }, public: mocks } }));

const note = { _id: 'synthetic-note', ownerId: 'synthetic-user', content: 'Read-only note', revision: 1,
  tags: [], attachments: [], color: 'default', createdAt: 1, modifiedAt: 1, public: false, shared: false, archived: false, sticky: false };
const Detail = defineComponent({ name: 'NoteDetailModal', props: ['open', 'canEdit', 'thing'], template: '<div />' });

async function render(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: applicationRouter.options.routes });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(RouterView, { global: { plugins: [router], stubs: { NoteDetailModal: Detail, ImageLightbox: true } } });
  await flushPromises();
  return { wrapper, router };
}

describe('Read-only note routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue({ thing: note });
    mocks.listThings.mockResolvedValue({ things: [note] });
    mocks.getThing.mockResolvedValue({ thing: note });
    mocks.userProfile.mockResolvedValue({ user: { username: 'Synthetic user', displayName: 'Synthetic user' } });
  });

  it.each([
    ['/note/synthetic-note', 'private-note'],
    ['/public/synthetic-user', 'public-stream'],
    ['/shared/synthetic-note', 'shared-note'],
  ])('renders %s without editing controls', async (path, name) => {
    const { wrapper, router } = await render(path);
    expect(router.currentRoute.value.name).toBe(name);
    expect(wrapper.text()).toContain('Read-only note');
    const card = wrapper.findComponent(NoteCard);
    expect(card.props('canEdit')).toBe(false);
    expect(wrapper.find('[aria-label="Note actions"]').exists()).toBe(false);
    expect(wrapper.find('textarea').exists()).toBe(false);
    if (name === 'public-stream') {
      await card.find('.open-note-btn').trigger('click');
      await flushPromises();
      const detail = wrapper.findComponent(Detail);
      expect(detail.props('open')).toBe(true);
      expect(detail.props('canEdit')).toBe(false);
    }
    wrapper.unmount();
  });

  it('does not render a private note when the read fails', async () => {
    mocks.get.mockRejectedValueOnce(new Error('Not authorized'));
    const { wrapper } = await render('/note/synthetic-note');
    expect(mocks.get).toHaveBeenCalledWith('synthetic-note');
    expect(wrapper.find('[role="alert"]').text()).toContain('Not authorized');
    expect(wrapper.findComponent(NoteCard).exists()).toBe(false);
    wrapper.unmount();
  });
});
