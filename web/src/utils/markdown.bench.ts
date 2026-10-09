import { bench, describe } from 'vitest';
import { renderMarkdown } from './markdown';

// Exceed the render cache's per-note limit so these measure parsing + sanitizing.
for (const count of [500, 2000]) {
  describe(`${count} list items (uncached)`, () => {
    const tasks = Array.from({ length: count }, (_, i) => `- [ ] Task ${i}: ${'details '.repeat(6)}`).join('\n');
    const plain = tasks.replace(/\[ \] /g, '');
    bench('task list', () => { renderMarkdown(tasks); }, { time: 500, iterations: 5 });
    bench('plain list', () => { renderMarkdown(plain); }, { time: 500, iterations: 5 });
  });
}
