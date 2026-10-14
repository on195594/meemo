import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ActionMenu from './ActionMenu.vue';

let wrapper: VueWrapper | undefined;
const choices = () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
function render() {
  wrapper = mount(ActionMenu, {
    props: { label: 'More actions' },
    slots: { trigger: 'More', default: '<button role="menuitem" tabindex="-1">Archive</button><button role="menuitem" tabindex="-1" disabled>Unavailable</button><button role="menuitem" tabindex="-1">Delete note</button>' },
    attachTo: document.body,
  });
  return wrapper.get('button');
}
function key(key: string, shiftKey = false) {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true }));
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ActionMenu', () => {
  it('opens from the keyboard, skips disabled items, wraps arrows and supports Home/End/typeahead', async () => {
    const trigger = render();
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();
    expect(document.activeElement).toBe(choices()[0]);
    expect(trigger.attributes('aria-haspopup')).toBe('menu');
    expect(document.querySelector('[role="menu"]')?.id).toBe(trigger.attributes('aria-controls'));
    key('ArrowDown'); expect(document.activeElement).toBe(choices()[2]);
    key('ArrowDown'); expect(document.activeElement).toBe(choices()[0]);
    key('ArrowUp'); expect(document.activeElement).toBe(choices()[2]);
    key('Home'); expect(document.activeElement).toBe(choices()[0]);
    key('End'); expect(document.activeElement).toBe(choices()[2]);
    key('a'); expect(document.activeElement).toBe(choices()[0]);
  });

  it('opens at the last item with ArrowUp and Escape returns focus without reaching a dialog listener', async () => {
    const trigger = render();
    const listener = vi.fn();
    window.addEventListener('keydown', listener);
    try {
      await trigger.trigger('keydown', { key: 'ArrowUp' });
      await flushPromises();
      expect(document.activeElement).toBe(choices()[2]);
      key('Escape'); await flushPromises();
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger.element);
      expect(listener).not.toHaveBeenCalled();
    } finally { window.removeEventListener('keydown', listener); }
  });

  it.each([false, true])('closes on Tab (shift=%s) from the trigger so native focus traversal can continue', async (shift) => {
    const trigger = render();
    await trigger.trigger('click'); await flushPromises();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true });
    document.activeElement!.dispatchEvent(event); await flushPromises();
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(trigger.element);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes on item selection and leaves an outside click/focus where it belongs', async () => {
    const trigger = render();
    await trigger.trigger('click'); await flushPromises();
    choices()[2].click(); await flushPromises();
    expect(document.activeElement).toBe(trigger.element);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    await trigger.trigger('click'); await flushPromises();
    const outside = document.createElement('button'); document.body.append(outside);
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true })); outside.focus();
    await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('closes an open menu if its owner becomes busy and prevents reopening', async () => {
    const trigger = render();
    await trigger.trigger('click'); await flushPromises();
    await wrapper!.setProps({ disabled: true }); await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect((trigger.element as HTMLButtonElement).disabled).toBe(true);
    await trigger.trigger('keydown', { key: 'ArrowDown' }); await flushPromises();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
});
