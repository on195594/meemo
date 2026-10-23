// Unsaved note text kept on this device so a closed tab, app switch or expired session loses nothing.
const PREFIX = 'meemo_draft:';

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

// Explicit logout removes every draft from this device; an expired session keeps them.
export function clearDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch { /* storage unavailable */ }
}
