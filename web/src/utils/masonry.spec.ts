import { describe, it, expect } from 'vitest';
import { distributeColumns, columnCountFor, estimateItemHeight } from './masonry';

describe('masonry', () => {
  it('distributes items in left-to-right row order when heights are uniform', () => {
    expect(distributeColumns([1, 2, 3, 4, 5], 3)).toEqual([[1, 4], [2, 5], [3]]);
  });

  it('balances columns by placing items in the shortest column to avoid blank gaps', () => {
    // 4 columns: item 1 (tall: 400), item 2 (short: 100), item 3 (tall: 400), item 4 (tall: 400)
    // Then item 5 (medium: 200) and item 6 (medium: 200) should both go to column 1 to fill its gap.
    const items = [
      { id: '1', h: 400 },
      { id: '2', h: 100 },
      { id: '3', h: 400 },
      { id: '4', h: 400 },
      { id: '5', h: 200 },
      { id: '6', h: 200 },
    ];
    const columns = distributeColumns(items, 4, (item) => item.h);
    expect(columns[0].map((x) => x.id)).toEqual(['1']);
    expect(columns[1].map((x) => x.id)).toEqual(['2', '5', '6']);
    expect(columns[2].map((x) => x.id)).toEqual(['3']);
    expect(columns[3].map((x) => x.id)).toEqual(['4']);
  });

  it('estimates card heights accurately and bounded by CSS rules', () => {
    const shortNote = { content: 'hello' };
    const longNote = { content: 'a'.repeat(2000) };
    const imageNote = { content: 'pic', attachments: [{ type: 'image', fileName: 'test.png' }] };

    const shortH = estimateItemHeight(shortNote);
    const longH = estimateItemHeight(longNote);
    const imgH = estimateItemHeight(imageNote);

    expect(shortH).toBeGreaterThanOrEqual(80);
    expect(longH).toBeGreaterThan(shortH);
    // Long note text is capped by MAX_BODY_HEIGHT (400) + base (80)
    expect(longH).toBeLessThanOrEqual(480);
    expect(imgH).toBeGreaterThan(shortH);
  });

  it('handles invalid or non-finite height functions gracefully', () => {
    const items = [1, 2, 3];
    const columns = distributeColumns(items, 2, () => NaN);
    expect(columns).toEqual([[1, 3], [2]]);
  });

  it('keeps empty trailing columns and tolerates bad counts', () => {
    expect(distributeColumns([1, 2], 4)).toEqual([[1], [2], [], []]);
    expect(distributeColumns([1, 2], 0)).toEqual([[1, 2]]);
    expect(distributeColumns([], 3)).toEqual([[], [], []]);
  });

  it('fits as many fixed-width cards as the width allows', () => {
    expect(columnCountFor(1008, 240, 16)).toBe(4);
    expect(columnCountFor(1000, 240, 16)).toBe(3);
    expect(columnCountFor(100, 240, 16)).toBe(1);
    expect(columnCountFor(358, 160, 8)).toBe(2);
  });
});
