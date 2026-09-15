import { describe, expect, it } from 'vitest';
import { highlightKeyword, renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
  it('renders standard markdown elements', () => {
    const html = renderMarkdown('# Heading\n\nThis is **bold** and *italic*.');
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders simple WikiLinks [[Note Title]] as internal links', () => {
    const html = renderMarkdown('Check out [[Architecture Design]] for details.');
    expect(html).toContain('<a class="wikilink" href="/?q=Architecture%20Design" data-wikilink="Architecture Design" title="Filter notes by &quot;Architecture Design&quot;">Architecture Design</a>');
  });

  it('renders aliased WikiLinks [[Target|Custom Label]] with custom text', () => {
    const html = renderMarkdown('Refer to [[Linux Kernel|内核实现]] here.');
    expect(html).toContain('<a class="wikilink" href="/?q=Linux%20Kernel" data-wikilink="Linux Kernel" title="Filter notes by &quot;Linux Kernel&quot;">内核实现</a>');
  });

  it('handles WikiLinks with Chinese characters and spaces safely', () => {
    const html = renderMarkdown('参考 [[分布式 存储 实践|分布式存储]] 章节。');
    expect(html).toContain('href="/?q=%E5%88%86%E5%B8%83%E5%BC%8F%20%E5%AD%98%E5%82%A8%20%E5%AE%9E%E8%B7%B5"');
    expect(html).toContain('data-wikilink="分布式 存储 实践"');
    expect(html).toContain('>分布式存储</a>');
  });

  it('ignores empty or newline WikiLinks', () => {
    expect(renderMarkdown('Empty [[]] brackets')).not.toContain('class="wikilink"');
    expect(renderMarkdown('Spaces [[   ]] only')).not.toContain('class="wikilink"');
    expect(renderMarkdown('Newline [[\nmultiline\n]]')).not.toContain('class="wikilink"');
    expect(renderMarkdown('Empty target [[|Custom Label]]')).not.toContain('class="wikilink"');
    expect(renderMarkdown('Whitespace target [[   | Custom ]]')).not.toContain('class="wikilink"');
  });

  it('does not parse inline code blocks as WikiLinks', () => {
    const html = renderMarkdown("Use `[[Don't Link Me]]` inside code.");
    expect(html).toContain("<code>[[Don't Link Me]]</code>");
    expect(html).not.toContain('class="wikilink"');
  });

  it('sanitizes malicious input in WikiLinks against XSS', () => {
    const html = renderMarkdown('Attack [[<script>alert(1)</script>|Safe Text]]');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('</script>');
    expect(html).toContain('Safe Text');
  });

  it('adds target="_blank" and rel to external links only', () => {
    const html = renderMarkdown('External: [Open](https://example.com) vs Internal: [[Target]]');
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Open</a>');
    const wikilink = html.match(/<a class="wikilink"[^>]*>/)?.[0] || '';
    expect(wikilink).not.toContain('target="_blank"');
  });
});

describe('highlightKeyword', () => {
  it('highlights single keyword in text nodes', () => {
    const html = '<p>Hello world from Meemo</p>';
    const highlighted = highlightKeyword(html, 'world');
    expect(highlighted).toBe('<p>Hello <mark>world</mark> from Meemo</p>');
  });

  it('highlights multiple terms separated by whitespace or Chinese punctuation', () => {
    const html = '<p>系统架构与性能优化实践</p>';
    const highlighted = highlightKeyword(html, '架构，优化');
    expect(highlighted).toBe('<p>系统<mark>架构</mark>与性能<mark>优化</mark>实践</p>');
  });

  it('strips hashtag and wikilink brackets from search terms when highlighting', () => {
    const html = '<p>Note about <a class="wikilink" href="/?q=Linux">Linux</a> and docker</p>';
    const highlighted = highlightKeyword(html, '[[Linux]] #docker');
    expect(highlighted).toContain('<a class="wikilink" href="/?q=Linux"><mark>Linux</mark></a>');
    expect(highlighted).toContain('<mark>docker</mark>');
  });

  it('highlights multi-word wikilinks and extracts target from aliased wikilinks', () => {
    const html = '<p>Check <a class="wikilink" href="/?q=Architecture%20Design">Architecture Design</a> and API Guide</p>';
    const highlighted = highlightKeyword(html, '[[Architecture Design]] [[API Guide|API 手册]]');
    expect(highlighted).toContain('<mark>Architecture Design</mark>');
    expect(highlighted).toContain('<mark>API Guide</mark>');
  });

  it('does not corrupt HTML attributes during highlighting', () => {
    const html = '<a class="wikilink" href="/?q=test" data-wikilink="test">test</a>';
    const highlighted = highlightKeyword(html, 'test');
    expect(highlighted).toBe('<a class="wikilink" href="/?q=test" data-wikilink="test"><mark>test</mark></a>');
  });
});
