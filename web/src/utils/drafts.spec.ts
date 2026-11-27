import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDrafts, createDraftScheduler, loadDraft, saveDraft } from './drafts';

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

  it('throttles rapid draft writes and flushes pending edits on demand or timer', () => {
    vi.useFakeTimers();
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const scheduler = createDraftScheduler(300);

    scheduler.schedule('note:1', { content: 'a' });
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    scheduler.schedule('note:1', { content: 'ab' });
    scheduler.schedule('note:1', { content: 'abc' });
    expect(setItemSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(300);
    expect(setItemSpy).toHaveBeenCalledTimes(2);
    expect(loadDraft('note:1')).toEqual({ content: 'abc' });

    scheduler.schedule('note:1', { content: 'abcd' });
    scheduler.schedule('note:1', { content: 'abcde' });
    scheduler.flush();
    expect(loadDraft('note:1')).toEqual({ content: 'abcde' });

    scheduler.schedule('note:1', { content: 'pending' });
    scheduler.schedule('note:1', null);
    expect(loadDraft('note:1')).toBeNull();
    vi.advanceTimersByTime(300);
    expect(loadDraft('note:1')).toBeNull();

    // Key switch flushes the previous key's pending edit before handling the new key
    scheduler.schedule('note:1', { content: 'first' });
    scheduler.schedule('note:1', { content: 'first-updated' });
    scheduler.schedule('note:2', null);
    expect(loadDraft('note:1')).toEqual({ content: 'first-updated' });

    // clearDrafts() fences pending timer and explicit flush from resurrecting erased drafts
    scheduler.schedule('note:2', { content: 'secret-1' });
    scheduler.schedule('note:2', { content: 'secret-2' });
    clearDrafts();
    vi.advanceTimersByTime(300);
    scheduler.flush();
    expect(loadDraft('note:2')).toBeNull();

    vi.useRealTimers();
  });
});
