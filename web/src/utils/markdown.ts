import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({
  breaks: true,
  html: true,
  linkify: true,
  typographer: false,
});

// Open external links in a new tab
const defaultRender =
  md.renderer.rules.link_open ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
  const href = tokens[idx].attrs?.[tokens[idx].attrIndex('href')]?.[1] || '';
  if (href.startsWith('http://') || href.startsWith('https://')) {
    const targetIndex = tokens[idx].attrIndex('target');
    if (targetIndex < 0) {
      tokens[idx].attrPush(['target', '_blank']);
      tokens[idx].attrPush(['rel', 'noopener noreferrer']);
    } else if (tokens[idx].attrs) {
      tokens[idx].attrs[targetIndex][1] = '_blank';
    }
  }
  return defaultRender(tokens, idx, options, env, self);
};

// Add lazy loading and async decoding to images
const defaultImageRender =
  md.renderer.rules.image ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options);
  };

md.renderer.rules.image = function (tokens, idx, options, env, self) {
  const token = tokens[idx];
  token.attrSet('loading', 'lazy');
  token.attrSet('decoding', 'async');
  return defaultImageRender(tokens, idx, options, env, self);
};

// Parse WikiLinks: [[Target]] or [[Target|Custom Label]]
function wikilinkRule(state: any, silent: boolean): boolean {
  if (
    state.src.charCodeAt(state.pos) !== 0x5b /* [ */ ||
    state.src.charCodeAt(state.pos + 1) !== 0x5b /* [ */
  ) {
    return false;
  }
  const start = state.pos + 2;
  const matchEnd = state.src.indexOf(']]', start);
  if (matchEnd === -1) return false;

  const inner = state.src.slice(start, matchEnd);
  if (inner.includes('\n') || !inner.trim()) return false;

  const parts = inner.split('|');
  const target = parts[0].trim();
  if (!target) return false;

  if (!silent) {
    const label = (parts.length > 1 ? parts.slice(1).join('|') : parts[0]).trim() || target;

    const token = state.push('wikilink', 'a', 0);
    token.attrs = [
      ['class', 'wikilink'],
      ['href', `/?q=${encodeURIComponent(target)}`],
      ['data-wikilink', target],
      ['title', `Filter notes by "${target}"`],
    ];
    token.content = label;
  }

  state.pos = matchEnd + 2;
  return true;
}

md.inline.ruler.before('link', 'wikilink', wikilinkRule);

md.renderer.rules.wikilink = function (tokens, idx, _options, _env, self) {
  const token = tokens[idx];
  const attrs = self.renderAttrs(token);
  return `<a${attrs}>${md.utils.escapeHtml(token.content)}</a>`;
};

// Task list support: parses "- [ ] " or "- [x] " in list items into interactive checkboxes
function taskListRule(state: any): void {
  const tokens = state.tokens;
  let taskIndex = 0;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== 'inline') continue;

    let isInsideLi = false;
    let liToken: any = null;
    let listToken: any = null;
    for (let j = i - 1; j >= 0; j--) {
      if (tokens[j].type === 'list_item_close') break;
      if (tokens[j].type === 'list_item_open') {
        isInsideLi = true;
        liToken = tokens[j];
        for (let k = j - 1; k >= 0; k--) {
          if (tokens[k].type === 'bullet_list_close' || tokens[k].type === 'ordered_list_close') break;
          if (tokens[k].type === 'bullet_list_open' || tokens[k].type === 'ordered_list_open') {
            listToken = tokens[k];
            break;
          }
        }
        break;
      }
    }
    if (!isInsideLi || !liToken) continue;

    const children = tokens[i].children;
    if (!children || children.length === 0 || children[0].type !== 'text') continue;
    const text = children[0].content;
    const match = text.match(/^\[([ xX])\]\s+/);
    if (!match) continue;

    const checked = match[1].toLowerCase() === 'x';
    const currentClass = liToken.attrGet('class') || '';
    liToken.attrSet('class', (currentClass ? currentClass + ' ' : '') + 'task-list-item' + (checked ? ' is-completed' : ''));

    if (listToken) {
      const listClass = listToken.attrGet('class') || '';
      if (!listClass.includes('task-list')) {
        listToken.attrSet('class', (listClass ? listClass + ' ' : '') + 'task-list');
      }
    }

    const checkbox = new state.Token('html_inline', '', 0);
    checkbox.content = `<input type="checkbox" class="task-list-item-checkbox" data-task-index="${taskIndex++}"${checked ? ' checked' : ''} aria-label="${checked ? 'Mark uncompleted' : 'Mark completed'}" /> `;
    children[0].content = text.slice(match[0].length);
    children.unshift(checkbox);
  }
}

md.core.ruler.after('inline', 'task_lists', taskListRule);

const markdownCache = new Map<string, string>();
const MAX_MARKDOWN_CACHE_SIZE = 500;
const MAX_CACHEABLE_CHARS = 16384; // 16K chars (~16-48 KB max across UTF-8/CJK), prevents caching huge notes

export function clearMarkdownCache(): void {
  markdownCache.clear();
}

export function renderMarkdown(content: string): string {
  if (!content) return '';
  const shouldCache = content.length <= MAX_CACHEABLE_CHARS;
  if (shouldCache) {
    const cached = markdownCache.get(content);
    if (cached !== undefined) return cached;
  }

  const rawHtml = md.render(content);
  const sanitized = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['input'],
    ADD_ATTR: [
      'target',
      'rel',
      'loading',
      'decoding',
      'data-wikilink',
      'type',
      'checked',
      'data-task-index',
      'aria-label',
      'class',
    ],
  });

  if (shouldCache) {
    if (markdownCache.size >= MAX_MARKDOWN_CACHE_SIZE) {
      const oldestKey = markdownCache.keys().next().value;
      if (oldestKey !== undefined) markdownCache.delete(oldestKey);
    }
    markdownCache.set(content, sanitized);
  }
  return sanitized;
}

// Toggles the checked state of the Nth task item in markdown text
export function toggleTaskItem(content: string, targetIndex: number): string {
  if (!content) return '';
  let inFence = false;
  let currentIndex = 0;
  const lines = content.split('\n');
  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;

    return line.replace(/^([ \t]*(?:[-*+]|\d+[.)])\s*\[)([ xX])(\]\s+)/, (match, prefix, status, suffix) => {
      if (currentIndex === targetIndex) {
        currentIndex++;
        const nextStatus = status === ' ' ? 'x' : ' ';
        return prefix + nextStatus + suffix;
      }
      currentIndex++;
      return match;
    });
  });
  return newLines.join('\n');
}

// Highlight search terms in already-sanitized HTML, touching only text nodes.
// Splits on HTML tags (<...>) so attributes (href, src, …) are never touched.
// Multi-word queries highlight each word independently.
export function highlightKeyword(html: string, keyword: string): string {
  if (!keyword) return html;
  // Collect individual terms: "#tag word" → ["tag", "word"]
  // Also extract [[target]] or [[target|label]] and support multi-delimiter
  const tokens = keyword.trim().match(/\[\[[^\]\n]+\]\]|[^\s,，、；;]+/g) || [];
  const terms = tokens
    .map((t) => {
      let term = t.trim();
      if (term.startsWith('[[') && term.endsWith(']]')) {
        term = term.slice(2, -2).trim();
        if (term.includes('|')) {
          term = term.split('|')[0].trim();
        }
      } else if (term.startsWith('#')) {
        term = term.slice(1).trim();
      }
      return term;
    })
    .filter(Boolean);
  if (!terms.length) return html;
  // Sort longer terms first so alternation prioritizes longer matches
  terms.sort((a, b) => b.length - a.length);
  // ponytail: simple tag-boundary split, not a full HTML parser — sufficient
  //   for our DOMPurify-sanitized markdown output; swap to TreeWalker if needed.
  const re = new RegExp(
    terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
    'gi'
  );
  return html.split(/(<[^>]*>)/).map((chunk) =>
    chunk.startsWith('<') ? chunk : chunk.replace(re, '<mark>$&</mark>')
  ).join('');
}
