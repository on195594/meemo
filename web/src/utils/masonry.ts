import { isImageAttachment } from './markdown';

const itemHeightCache = new WeakMap<object, number>();

/**
 * Estimates card height in pixels based on content and attachments, bounded by CSS rules.
 * Bounds text sampling independently of note length; never measures DOM or triggers reflow.
 */
export function estimateItemHeight(item: unknown): number {
  if (typeof item !== 'object' || item === null) {
    return 100;
  }
  const cached = itemHeightCache.get(item);
  if (cached !== undefined) {
    return cached;
  }
  const candidate = item as {
    content?: unknown;
    richContent?: unknown;
    attachments?: unknown;
  };
  // Match NoteCard.bodyPreview: a nonempty rich body wins, including whitespace.
  const text = typeof candidate.richContent === 'string' && candidate.richContent
    ? candidate.richContent
    : typeof candidate.content === 'string'
      ? candidate.content
      : '';
  const attachments = Array.isArray(candidate.attachments) ? candidate.attachments : [];

  // Base card chrome: padding + header/actions reserve
  const BASE_HEIGHT = 80;
  // NoteCard .card-body has CSS max-height: 400px
  const MAX_BODY_HEIGHT = 400;

  let textHeight = 0;
  if (text) {
    // Sampling is stricter than NoteCard's 4000-character / 40-line preview; CSS caps at 20 visual lines.
    const sample = text.length > 1000 ? text.slice(0, 1000) : text;
    const lines = sample.split('\n', 20);
    let totalVisualLines = 0;
    for (let i = 0; i < lines.length && totalVisualLines < 20; i++) {
      const len = lines[i].length;
      // ~25 characters per line on a standard 240px card
      totalVisualLines += Math.max(1, Math.ceil(len / 25));
    }
    textHeight = Math.min(MAX_BODY_HEIGHT, totalVisualLines * 20);
  }

  let attachHeight = 0;
  let imageCount = 0;
  let fileCount = 0;

  for (const att of attachments) {
    if (isImageAttachment(att as Parameters<typeof isImageAttachment>[0])) {
      imageCount++;
    } else if (att) {
      fileCount++;
    }
  }

  if (imageCount > 0) {
    attachHeight += imageCount === 1 ? 220 : Math.min(320, 110 * Math.ceil(imageCount / 2));
  }
  if (fileCount > 0) {
    attachHeight += Math.min(120, fileCount * 36);
  }

  const height = BASE_HEIGHT + textHeight + attachHeight;
  itemHeightCache.set(item, height);
  return height;
}

// Bounded heuristic masonry: places each item into the shortest column using CSS-bounded height estimates.
// Preserves left-to-right row order when item heights are equal.
export function distributeColumns<T>(
  items: readonly T[],
  columnCount: number,
  getHeight?: (item: T) => number
): T[][] {
  const n = Math.max(1, Math.floor(columnCount) || 1);
  // Always n columns so short sections (e.g. two pinned notes) stay left-aligned with the grid.
  const columns: T[][] = Array.from({ length: n }, () => []);
  if (items.length === 0) return columns;

  const colHeights = new Array(n).fill(0);

  for (const item of items) {
    const rawH = getHeight ? getHeight(item) : estimateItemHeight(item);
    const height = Number.isFinite(rawH) && rawH > 0 ? rawH : 100;

    let shortest = 0;
    let minH = colHeights[0];
    for (let c = 1; c < n; c++) {
      if (colHeights[c] < minH) {
        minH = colHeights[c];
        shortest = c;
      }
    }

    columns[shortest].push(item);
    colHeights[shortest] += height;
  }

  return columns;
}

export function columnCountFor(width: number, cardWidth: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
}
