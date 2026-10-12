import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, ref } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  consent: vi.fn(), connections: vi.fn(), decide: vi.fn(), revoke: vi.fn(),
  route: { name: 'assistant-authorize', query: { request: 'a'.repeat(43) } },
}));
const user = ref<{ id: string } | null>({ id: 'synthetic-user' });
const authenticated = ref(true);
vi.mock('vue-router', () => ({ useRoute: () => mocks.route }));
vi.mock('../composables/useAuth', () => ({ useAuth: () => ({ user, isAuthenticated: authenticated }) }));
vi.mock('../api/client', () => ({
  api: { mcp: mocks },
  ApiError: class ApiError extends Error { constructor(public status: number) { super('Synthetic error'); } },
}));
import AssistantView from './AssistantView.vue';

const Link = defineComponent({ template: '<a><slot /></a>' });
function render() { return mount(AssistantView, { global: { stubs: { RouterLink: Link }, provide: { openAuthModal: vi.fn() } } }); }

describe('Assistant consent and connections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated.value = true;
    user.value = { id: 'synthetic-user' };
    mocks.route.name = 'assistant-authorize';
    mocks.route.query.request = 'a'.repeat(43);
    mocks.consent.mockResolvedValue({ clientName: '<script>malicious</script>', username: 'Alice', scope: 'notes.read', expiresIn: 86400, csrfToken: 'synthetic-csrf' });
    mocks.connections.mockResolvedValue({ enabled: true, resource: 'https://meemo.example/mcp', csrfToken: 'synthetic-csrf', connections: [
      { id: 'synthetic-grant', clientName: 'Gemini', scope: 'notes.read', expiresAt: '2026-10-13T00:00:00Z', createdAt: '2026-10-12T00:00:00Z' },
    ] });
    mocks.revoke.mockResolvedValue(undefined);
    mocks.decide.mockRejectedValue(new Error('Synthetic failure'));
  });

  it('discloses private-note transfer, renders client names as text and requires acknowledgement', async () => {
    const wrapper = render();
    await flushPromises();
    expect(wrapper.text()).toContain('private notes');
    expect(wrapper.text()).toContain('sent to Google');
    expect(wrapper.find('script').exists()).toBe(false);
    const allow = wrapper.findAll('button').find(button => button.text() === 'Allow read access')!;
    expect(allow.attributes('disabled')).toBeDefined();
    await wrapper.find('input[type="checkbox"]').setValue(true);
    await allow.trigger('click');
    await flushPromises();
    expect(mocks.decide).toHaveBeenCalledWith('a'.repeat(43), true, 'synthetic-csrf');
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('allows denial without checking acknowledgement and reports errors', async () => {
    const wrapper = render();
    await flushPromises();
    await wrapper.findAll('button').find(button => button.text() === 'Deny')!.trigger('click');
    await flushPromises();
    expect(mocks.decide).toHaveBeenCalledWith('a'.repeat(43), false, 'synthetic-csrf');
    expect(wrapper.text()).toContain('may have expired');
    wrapper.unmount();
  });

  it('does not fetch private consent data when logged out', async () => {
    authenticated.value = false;
    user.value = null;
    const wrapper = render();
    await flushPromises();
    expect(mocks.consent).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('Log in');
    wrapper.unmount();
  });

  it('revokes the selected grant and shows the empty state', async () => {
    mocks.route.name = 'assistant-connections';
    const wrapper = render();
    await flushPromises();
    await wrapper.find('[aria-label="Revoke Gemini"]').trigger('click');
    await flushPromises();
    expect(mocks.revoke).toHaveBeenCalledWith('synthetic-grant', 'synthetic-csrf');
    expect(wrapper.text()).toContain('No active assistant connections');
    expect(wrapper.text()).toContain('Connection revoked');
    wrapper.unmount();
  });

  it('ignores stale private responses after account changes', async () => {
    let resolve!: (value: unknown) => void;
    mocks.consent.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const wrapper = render();
    authenticated.value = false;
    user.value = null;
    await flushPromises();
    resolve({ clientName: 'Stale client', username: 'Alice', csrfToken: 'stale' });
    await flushPromises();
    expect(wrapper.text()).not.toContain('Stale client');
    wrapper.unmount();
  });
});
