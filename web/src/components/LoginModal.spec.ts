import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '../composables/useAuth';
import LoginModal from './LoginModal.vue';

vi.mock('../composables/useAuth', () => ({ useAuth: vi.fn() }));
enableAutoUnmount(afterEach);
const register = vi.fn();
const clearError = vi.fn();
const isFirstUser = ref(false);
function render(initialTab: 'login' | 'register' = 'register') {
  return mount(LoginModal, { props: { modelValue: true, initialTab } });
}
const fields = { username: ' Alice ', displayName: ' Alice Example ', email: ' alice@example.test ', password: 'password123' };
async function fill(wrapper: ReturnType<typeof render>, overrides: Partial<typeof fields> = {}) {
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) await wrapper.get(`#reg-${key}`).setValue(value);
}
beforeEach(() => {
  vi.resetAllMocks();
  isFirstUser.value = false;
  vi.mocked(useAuth).mockReturnValue({ isLoading: ref(false), authError: ref(null), isFirstUser, login: vi.fn(), register, clearError } as unknown as ReturnType<typeof useAuth>);
  register.mockResolvedValue({ success: true });
});

describe('LoginModal registration', () => {
  it('switches login/register forms and clears validation errors on tab changes', async () => {
    const wrapper = render('login');
    expect(wrapper.find('#login-username').exists()).toBe(true);
    await wrapper.findAll('.tab-btn')[1].trigger('click');
    expect(wrapper.find('#reg-username').exists()).toBe(true);
    expect(wrapper.find('#login-username').exists()).toBe(false);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    await wrapper.findAll('.tab-btn')[0].trigger('click');
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    expect(wrapper.get('.tab-btn.active').text()).toBe('Log In');
    expect(clearError).toHaveBeenCalledTimes(3);
  });

  it('guides the first user directly to administrator registration', () => {
    isFirstUser.value = true;
    const wrapper = render('login');
    expect(wrapper.get('[role="status"]').text()).toContain('Create your administrator account');
    expect(wrapper.get('h2').text()).toBe('Create First Account');
    expect(wrapper.find('.tab-switcher').exists()).toBe(false);
    expect(wrapper.find('#reg-username').exists()).toBe(true);
    expect(wrapper.get('[type="submit"]').text()).toBe('Create Administrator Account');
  });

  it('submits normalized registration fields and closes after success', async () => {
    const wrapper = render();
    await fill(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(register).toHaveBeenCalledExactlyOnceWith({ username: 'alice', displayName: 'Alice Example', email: 'alice@example.test', password: 'password123' });
    expect(wrapper.emitted('success')).toHaveLength(1);
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
    expect((wrapper.get('#reg-password').element as HTMLInputElement).value).toBe('');
  });

  it.each([
    ['username', 'a!', 'Username must be'],
    ['displayName', ' ', 'Display name must be'],
    ['email', 'invalid', 'valid email address'],
    ['password', 'short', 'Password must be'],
  ])('rejects invalid %s before registration', async (field, value, message) => {
    const wrapper = render();
    await fill(wrapper, { [field]: value });
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('[role="alert"]').text()).toContain(message);
    expect(register).not.toHaveBeenCalled();
    expect(wrapper.emitted('success')).toBeUndefined();
  });

  it('displays registration failures and keeps the form open', async () => {
    register.mockResolvedValue({ success: false, error: 'Username already exists' });
    const wrapper = render();
    await fill(wrapper);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Username already exists');
    expect(wrapper.emitted('success')).toBeUndefined();
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
