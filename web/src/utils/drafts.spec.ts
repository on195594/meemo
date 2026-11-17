import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, loadDraft, saveDraft } from './drafts';

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

describe('device drafts', () => {
  it('round-trips structured drafts under the draft prefix and removes null drafts', () => {
    const draft = { content: 'unfinished', attachments: [], baseline: { revision: 2 } };
    saveDraft('note:alice:1', draft);
    expect(localStorage.getItem('meemo_draft:note:alice:1')).toBe(JSON.stringify(draft));
    expect(loadDraft('note:alice:1')).toEqual(draft);
    saveDraft('note:alice:1', null);
    expect(loadDraft('note:alice:1')).toBeNull();
  });

  it('tolerates missing keys, null scopes, and malformed JSON', () => {
    localStorage.setItem('meemo_draft:broken', '{');
    expect(loadDraft('broken')).toBeNull();
    expect(loadDraft('missing')).toBeNull();
    expect(loadDraft(null)).toBeNull();
    saveDraft(null, { content: 'ignored' });
    expect(localStorage.length).toBe(1);
  });

  it('clears all drafts while preserving keys outside the exact prefix', () => {
    for (const key of ['composer:alice', 'note:alice:1', 'composer:bob']) saveDraft(key, { content: key });
    const unrelated = ['meemo_theme', 'meemo_draft', 'other:meemo_draft:note'];
    for (const key of unrelated) localStorage.setItem(key, 'keep');
    clearDrafts();
    expect(localStorage.length).toBe(unrelated.length);
    for (const key of unrelated) expect(localStorage.getItem(key)).toBe('keep');
  });

  it('does not read an unprefixed key', () => {
    localStorage.setItem('note:1', JSON.stringify({ content: 'unrelated' }));
    expect(loadDraft('note:1')).toBeNull();
  });

  it.each(['getItem', 'setItem', 'removeItem', 'key'] as const)('tolerates storage %s exceptions', (method) => {
    saveDraft('note:1', 'draft');
    vi.spyOn(Storage.prototype, method).mockImplementation(() => { throw new Error('Storage unavailable'); });
    if (method === 'getItem') expect(loadDraft('note:1')).toBeNull();
    else if (method === 'setItem') expect(() => saveDraft('note:1', 'new')).not.toThrow();
    else {
      if (method === 'removeItem') expect(() => saveDraft('note:1', null)).not.toThrow();
      expect(() => clearDrafts()).not.toThrow();
    }
  });
});
