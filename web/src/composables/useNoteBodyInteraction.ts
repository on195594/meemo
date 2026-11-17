import type { AttachmentDescriptor } from '../api/client';
import { isImageAttachment } from '../utils/markdown';

export function useNoteBodyInteraction(options: {
  canEdit: () => boolean;
  hasImageClickListener: () => boolean;
  attachmentUrl: (attachment: AttachmentDescriptor) => string;
  onTask?: (checkbox: HTMLInputElement, index: number) => Promise<void>;
  onImage: (src: string) => void;
  onTag: (tag: string) => void;
  onWikilink: (target: string) => void;
}) {
  function isPlainClick(event: MouseEvent) {
    return !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0;
  }

  function handleAttachmentClick(event: MouseEvent, attachment: AttachmentDescriptor) {
    if (options.hasImageClickListener() && isImageAttachment(attachment) && isPlainClick(event)) {
      event.preventDefault();
      options.onImage(options.attachmentUrl(attachment));
    }
  }

  async function handleBodyClick(event: MouseEvent) {
    if (!isPlainClick(event)) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const checkbox = target.closest<HTMLInputElement>('.task-list-item-checkbox');
    if (checkbox) {
      event.stopPropagation();
      if (!options.canEdit()) {
        event.preventDefault();
        return;
      }
      const rawIndex = checkbox.dataset.taskIndex;
      if (rawIndex === undefined) return;
      const index = parseInt(rawIndex, 10);
      if (isNaN(index)) return;
      await options.onTask?.(checkbox, index);
      return;
    }

    const image = target.closest('img');
    if (image && options.hasImageClickListener() && !image.closest('a')) {
      event.preventDefault();
      event.stopPropagation();
      options.onImage(image.getAttribute('src') || '');
      return;
    }

    const anchor = target.closest('a');
    if (!anchor) return;
    if (anchor.classList.contains('wikilink') || anchor.dataset.wikilink) {
      event.preventDefault();
      const query = anchor.dataset.wikilink || anchor.textContent?.trim() || '';
      if (query) options.onWikilink(query);
      return;
    }
    const href = anchor.getAttribute('href') || '';
    if (href.startsWith('#search?#')) {
      event.preventDefault();
      const tag = href.replace('#search?#', '').trim();
      if (tag) options.onTag(tag);
    }
  }

  return { handleBodyClick, handleAttachmentClick };
}
