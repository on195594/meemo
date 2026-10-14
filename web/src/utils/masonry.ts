// Row-order masonry (Keep reads left-to-right): item i goes to column i % n.
// shortcut: ignores card heights, so columns can end unevenly; measure heights and fill the shortest column if that matters.
export function distributeColumns<T>(items: readonly T[], columnCount: number): T[][] {
  const n = Math.max(1, Math.floor(columnCount) || 1);
  // Always n columns so short sections (e.g. two pinned notes) stay left-aligned with the grid.
  const columns: T[][] = Array.from({ length: n }, () => []);
  items.forEach((item, i) => columns[i % columns.length].push(item));
  return columns;
}

export function columnCountFor(width: number, cardWidth: number, gap: number): number {
  return Math.max(1, Math.floor((width + gap) / (cardWidth + gap)));
}
