import type { NoteColor } from '../api/client';

export const NOTE_COLORS = [
  { key: 'default', name: 'Default' },
  { key: 'coral', name: 'Coral' },
  { key: 'peach', name: 'Peach' },
  { key: 'sand', name: 'Sand' },
  { key: 'mint', name: 'Mint' },
  { key: 'sage', name: 'Sage' },
  { key: 'fog', name: 'Fog' },
  { key: 'storm', name: 'Storm' },
  { key: 'dusk', name: 'Dusk' },
  { key: 'blossom', name: 'Blossom' },
  { key: 'clay', name: 'Clay' },
  { key: 'chalk', name: 'Chalk' },
] as const satisfies ReadonlyArray<{ key: NoteColor; name: string }>;
