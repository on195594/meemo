import { describe, it, expect } from 'vitest';
import { columnCountFor, estimateItemHeight, layoutMasonry } from './masonry';

describe('masonry', () => {
  it('places uniform-height items in left-to-right row order across columns', () => {
    const layout = layoutMasonry([1, 2, 3, 4, 5], 3, 16);
    expect(layout.placements.map((p) => [p.item, p.column])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 0],
      [5, 1],
    ]);
  });

  it('reuses cached item height for identical object references', () => {
    const note = { content: 'cached note text' };
    const firstH = estimateItemHeight(note);
    const secondH = estimateItemHeight(note);
    expect(firstH).toBe(secondH);
  });

  it('balances columns by placing items in the shortest column to avoid blank gaps', () => {
    const items = [
      { id: '1', h: 400 },
      { id: '2', h: 100 },
      { id: '3', h: 400 },
      { id: '4', h: 400 },
      { id: '5', h: 200 },
      { id: '6', h: 200 },
    ];
    const layout = layoutMasonry(items, 4, 16, (item) => item.h);
    const columns: string[][] = [[], [], [], []];
    layout.placements.forEach((p) => columns[p.column].push(p.item.id));
    expect(columns).toEqual([['1'], ['2', '5', '6'], ['3'], ['4']]);
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

  it.each([
    ['short plain / long rich', '短', '长'.repeat(1000), 480],
    ['long plain / short rich', '长'.repeat(1000), '短', 100],
    ['empty rich', 'plain', '', 100],
    ['missing rich', 'plain', undefined, 100],
    ['invalid rich', 'plain', 42, 100],
    ['rich only', undefined, '长'.repeat(1000), 480],
    ['whitespace rich is not empty', '长'.repeat(1000), ' ', 100],
  ])('estimates the body selected by NoteCard: %s', (_name, content, richContent, expected) => {
    expect(estimateItemHeight({ content, richContent })).toBe(expected);
  });

  it('uses the displayed rich body when choosing the shortest column', () => {
    const rich = { content: '短', richContent: '长'.repeat(1000) };
    const plain = { content: 'short' };
    const next = { content: 'next' };
    const layout = layoutMasonry([rich, plain, next], 2, 16);
    expect(layout.placements).toEqual([
      { item: rich, column: 0, top: 0 },
      { item: plain, column: 1, top: 0 },
      { item: next, column: 1, top: 116 },
    ]);
  });

  it.each([
    'x'.repeat(4000),
    Array.from({ length: 40 }, () => 'line').join('\n'),
  ])('ignores text beyond the bounded card preview', (prefix) => {
    expect(estimateItemHeight({ content: 'short', richContent: prefix + '\nhidden'.repeat(10000) }))
      .toBe(estimateItemHeight({ richContent: prefix }));
  });

  it('retains image and file attachment estimates with a rich body', () => {
    const body = { content: 'short', richContent: '长'.repeat(1000) };
    const attachments = [
      { identifier: 'image', fileName: 'photo.png', type: 'image' },
      { identifier: 'file', fileName: 'report.pdf' },
    ];
    expect(estimateItemHeight({ ...body, attachments })).toBe(480 + 220 + 36);
  });

  it('handles invalid heights and non-positive column counts gracefully', () => {
    const nanLayout = layoutMasonry([1, 2, 3], 2, 16, () => NaN);
    expect(nanLayout.placements.map((p) => [p.item, p.column, p.top])).toEqual([
      [1, 0, 0],
      [2, 1, 0],
      [3, 0, 116],
    ]);
    const zeroColLayout = layoutMasonry([1, 2], 0, 16, () => 100);
    expect(zeroColLayout.placements.map((p) => p.column)).toEqual([0, 0]);
  });

  it('fits as many fixed-width cards as the width allows', () => {
    expect(columnCountFor(1008, 240, 16)).toBe(4);
    expect(columnCountFor(1000, 240, 16)).toBe(3);
    expect(columnCountFor(100, 240, 16)).toBe(1);
    expect(columnCountFor(358, 160, 8)).toBe(2);
  });

  it('computes flat masonry placements and total height without column buckets', () => {
    const items = [
      { id: '1', h: 200 },
      { id: '2', h: 100 },
      { id: '3', h: 120 },
    ];
    const layout = layoutMasonry(items, 2, 16, (item) => item.h);
    expect(layout.placements).toEqual([
      { item: items[0], column: 0, top: 0 },
      { item: items[1], column: 1, top: 0 },
      { item: items[2], column: 1, top: 116 },
    ]);
    expect(layout.height).toBe(236);
    expect(layoutMasonry([], 2, 16)).toEqual({ placements: [], height: 0 });
  });
});
