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

export function renderMarkdown(content: string): string {
  if (!content) return '';
  const rawHtml = md.render(content);
  return DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel', 'loading', 'decoding'],
  });
}

// Highlight search terms in already-sanitized HTML, touching only text nodes.
// Splits on HTML tags (<...>) so attributes (href, src, …) are never touched.
// Multi-word queries highlight each word independently.
export function highlightKeyword(html: string, keyword: string): string {
  if (!keyword) return html;
  // Collect individual terms: "#tag word" → ["tag", "word"]
  const terms = keyword.trim().split(/\s+/).map((w) =>
    w.startsWith('#') ? w.slice(1) : w
  ).filter(Boolean);
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
