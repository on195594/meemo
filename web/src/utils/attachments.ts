import type { Thing, AttachmentDescriptor } from '../api/client';
import type { LightboxImage } from '../components/ImageLightbox.vue';
import { isImageAttachment } from './markdown';

export function attachmentUrl(thing: Thing, att: AttachmentDescriptor): string {
  return `/api/files/${thing.ownerId || 'me'}/${thing._id}/${att.identifier}`;
}

export function imageAttachments(thing: Thing): AttachmentDescriptor[] {
  return (thing.attachments || []).filter(isImageAttachment);
}

export function fileAttachments(thing: Thing): AttachmentDescriptor[] {
  return (thing.attachments || []).filter(att => !isImageAttachment(att));
}

export function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function collectImages(thing: Thing, body: HTMLElement | null): LightboxImage[] {
  const images: LightboxImage[] = [];
  if (body) {
    const imgs = body.querySelectorAll<HTMLImageElement>('img');
    imgs.forEach((img) => {
      const src = img.getAttribute('src');
      if (src) {
        images.push({
          src,
          alt: img.getAttribute('alt') || '',
          title: img.getAttribute('title') || img.getAttribute('alt') || '',
        });
      }
    });
  }
  if (thing.attachments && thing.attachments.length > 0) {
    for (const att of thing.attachments) {
      if (isImageAttachment(att)) {
        const src = attachmentUrl(thing, att);
        if (!images.some((i) => i.src === src)) {
          images.push({
            src,
            alt: att.fileName || att.identifier,
            title: att.fileName || att.identifier,
          });
        }
      }
    }
  }
  return images;
}

