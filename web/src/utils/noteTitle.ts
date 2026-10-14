// Meemo stores only `content`; a leading `# Heading` line acts as the Keep-style note title.
const TITLE_RE = /^# (.+)\r?\n?/;

export function splitTitle(content: string): { title: string; body: string } {
  const match = TITLE_RE.exec(content);
  if (!match) return { title: '', body: content };
  return { title: match[1].trim(), body: content.slice(match[0].length).replace(/^(\r?\n)+/, '') };
}

export function joinTitle(title: string, body: string): string {
  const t = title.replace(/\s*\n\s*/g, ' ').trim();
  // Drop blank lines and trailing space only; leading indentation is Markdown (e.g. code blocks).
  const b = body.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
  if (!t) return b.trim(); // the store trims untitled content on save anyway
  return b ? `# ${t}\n\n${b}` : `# ${t}`;
}
