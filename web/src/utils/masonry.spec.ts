import { describe, it, expect } from 'vitest';
import { distributeColumns, columnCountFor } from './masonry';

describe('masonry', () => {
  it('distributes items in left-to-right row order', () => {
    expect(distributeColumns([1, 2, 3, 4, 5], 3)).toEqual([[1, 4], [2, 5], [3]]);
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
