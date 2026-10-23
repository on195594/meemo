import type { Thing } from '../api/client';

const VERBS = { create: 'added', update: 'edited', delete: 'trashed' } as const;

// Human-readable trace of the latest assistant write, e.g. "Gemini edited".
export function assistantLabel(thing: Thing): string {
  return thing.assistant ? `${thing.assistant.client} ${VERBS[thing.assistant.action]}` : '';
}
