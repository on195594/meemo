// Meemo stores only `content`; a leading `# Heading` line acts as the Keep-style note title.
const TITLE_RE = /^# (.+)\r?\n?/;

export function splitTitle(content: string): { title: string; body: string } {
  const match = TITLE_RE.exec(content);
  if (!match) return { title: '', body: content };
  return { title: match[1].trim(), body: content.slice(match[0].length).replace(/^(\r?\n)+/, '') };
}

export function joinTitle(title: string, body: string): string {
  const t = title.replace(/\s*\n\s*/g, ' ').trim();
  const b = body.trim();
  if (!t) return b;
  return b ? `# ${t}\n\n${b}` : `# ${t}`;
}
