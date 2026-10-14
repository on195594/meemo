import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, ref, toRef } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePopoverPosition } from './usePopoverPosition';

const Fixture = defineComponent({
  props: { open: Boolean },
  setup(props) {
    const anchor = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null);
    usePopoverPosition(anchor, panel, toRef(props, 'open'));
    return { anchor, panel };
  },
  template: '<button ref="anchor" data-anchor>Open</button><div v-if="open" ref="panel" data-panel>Panel</div>',
});
let wrapper: VueWrapper | undefined;
let anchorLeft = 300, anchorTop = 200;

beforeEach(() => {
  anchorLeft = 300; anchorTop = 200;
  vi.stubGlobal('innerWidth', 400); vi.stubGlobal('innerHeight', 300);
  vi.stubGlobal('visualViewport', undefined);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-anchor')
      ? { left: anchorLeft, right: anchorLeft + 40, top: anchorTop, bottom: anchorTop + 40, width: 40, height: 40 } as DOMRect
      : { width: 200, height: 160 } as DOMRect;
  });
});
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe('anchored popover placement', () => {
  it('clamps the right edge, flips above a low trigger and follows scrolling', async () => {
    wrapper = mount(Fixture, { props: { open: false } });
    await wrapper.setProps({ open: true }); await flushPromises();
    const panel = wrapper.get('[data-panel]').element as HTMLElement;
    expect(panel.style.left).toBe('192px');
    expect(panel.style.top).toBe('36px');
    expect(panel.style.maxWidth).toBe('384px');
    anchorLeft = 100; anchorTop = 40;
    window.dispatchEvent(new Event('scroll'));
    expect(panel.style.left).toBe('100px');
    expect(panel.style.top).toBe('84px');
  });

  it.each(['hide', 'unmount'])('removes resize/scroll listeners on %s', async (action) => {
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    wrapper = mount(Fixture, { props: { open: false } });
    await wrapper.setProps({ open: true }); await flushPromises();
    const position = add.mock.calls.find(([type]) => type === 'resize')![1];
    remove.mockClear();
    if (action === 'hide') await wrapper.setProps({ open: false });
    else { wrapper.unmount(); wrapper = undefined; }
    expect(remove).toHaveBeenCalledWith('resize', position);
    expect(remove).toHaveBeenCalledWith('scroll', position, true);
    expect(remove).toHaveBeenCalledWith('transitionend', position, true);
  });
});
