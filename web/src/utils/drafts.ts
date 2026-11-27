// Unsaved note text kept on this device so a closed tab, app switch or expired session loses nothing.
const PREFIX = 'meemo_draft:';
let clearGeneration = 0;

export function loadDraft<T>(key: string | null): T | null {
  if (!key) return null;
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

// A null value removes the draft.
export function saveDraft(key: string | null, value: unknown): void {
  if (!key) return;
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch { /* storage unavailable: the in-memory draft still works */ }
}

/**
 * Leading+trailing draft persistence throttle: persists the first edit immediately,
 * coalesces rapid keystrokes inside `delayMs` in memory, flushes pending edits on
 * key switch or explicit flush, and ignores writes invalidated by `clearDrafts()`.
 */
export function createDraftScheduler(delayMs = 300) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { key: string | null; value: unknown; generation: number } | null = null;

  function commitPending(): void {
    if (pending === null) return;
    const next = pending;
    pending = null;
    if (next.generation === clearGeneration) {
      saveDraft(next.key, next.value);
    }
  }

  function flush(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    commitPending();
  }

  function cancel(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  function schedule(key: string | null, value: unknown): void {
    if (pending !== null && pending.key !== key) {
      flush();
    }
    if (value === null) {
      cancel();
      saveDraft(key, null);
      return;
    }
    const generation = clearGeneration;
    if (timer === null) {
      saveDraft(key, value);
      timer = setTimeout(() => {
        timer = null;
        commitPending();
      }, delayMs);
    } else {
      pending = { key, value, generation };
    }
  }

  return { schedule, flush, cancel };
}

// Explicit logout removes every draft from this device; an expired session keeps them.
export function clearDrafts(): void {
  clearGeneration++;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}
