import { nextTick, onUnmounted, watch, type Ref } from 'vue';

export function usePopoverPosition(
  anchor: Ref<HTMLElement | null>,
  panel: Ref<HTMLElement | null>,
  open: Ref<boolean>,
) {
  function position() {
    if (!open.value || !anchor.value || !panel.value) return;
    const rect = anchor.value.getBoundingClientRect();
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft || 0) + 8;
    const topEdge = (viewport?.offsetTop || 0) + 8;
    const rightEdge = leftEdge + (viewport?.width || window.innerWidth) - 16;
    const bottomEdge = topEdge + (viewport?.height || window.innerHeight) - 16;
    panel.value.style.maxWidth = `${rightEdge - leftEdge}px`;
    panel.value.style.maxHeight = `${bottomEdge - topEdge}px`;
    const { width, height } = panel.value.getBoundingClientRect();
    const left = Math.max(leftEdge, Math.min(rect.left, rightEdge - width));
    const below = rect.bottom + 4;
    const preferredTop = below + height <= bottomEdge ? below : rect.top - height - 4;
    const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - height));
    panel.value.style.left = `${left}px`;
    panel.value.style.top = `${top}px`;
  }

  function cleanup() {
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    window.removeEventListener('transitionend', position, true);
    window.visualViewport?.removeEventListener('resize', position);
    window.visualViewport?.removeEventListener('scroll', position);
  }

  watch(open, async (visible) => {
    cleanup();
    if (!visible) return;
    await nextTick();
    if (!open.value) return;
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('transitionend', position, true);
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
  });
  onUnmounted(cleanup);
}
