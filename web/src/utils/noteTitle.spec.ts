import { describe, it, expect } from 'vitest';
import { splitTitle, joinTitle } from './noteTitle';

describe('noteTitle', () => {
  it('splits a leading H1 into the title', () => {
    expect(splitTitle('# Groceries\n\n- [ ] milk')).toEqual({ title: 'Groceries', body: '- [ ] milk' });
    expect(splitTitle('# Only title')).toEqual({ title: 'Only title', body: '' });
  });

  it('leaves content without a leading H1 untouched', () => {
    expect(splitTitle('plain #tag text')).toEqual({ title: '', body: 'plain #tag text' });
    expect(splitTitle('## Subheading\nbody')).toEqual({ title: '', body: '## Subheading\nbody' });
    expect(splitTitle('#tag first')).toEqual({ title: '', body: '#tag first' });
  });

  it('joins title and body and round-trips', () => {
    expect(joinTitle('Trip', 'Day 1')).toBe('# Trip\n\nDay 1');
    expect(joinTitle('  ', ' body ')).toBe('body');
    expect(joinTitle('Title', '')).toBe('# Title');
    expect(joinTitle('a\nb', 'x')).toBe('# a b\n\nx');
    expect(joinTitle('Code', '\n    const answer = 42;\n')).toBe('# Code\n\n    const answer = 42;');
    const content = '# Trip\n\nDay 1\nDay 2';
    const { title, body } = splitTitle(content);
    expect(joinTitle(title, body)).toBe(content);
  });
});
