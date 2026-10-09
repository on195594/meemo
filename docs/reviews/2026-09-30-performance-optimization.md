# Performance optimization snapshot — 2026-09-30

## Scope and safety

Reviewed the note read/write path, MongoDB queries/indexes, frontend routing/rendering, static delivery/session setup, and import/export flow. Changes target demonstrated redundant work, not infrastructure replacement. No dependencies, API contracts, database indexes, authentication controls, or search semantics changed. Production data was not used for benchmarks; no deployment was performed.

## Implemented

- `src/services/thing-service.js`: extract URLs once per write and reuse them for tag parsing and SSRF-protected enrichment. For notes containing both URLs and tags, Markdown parser invocations fall from three to two. Create responses reuse the inserted document instead of issuing an additional read.
- `web/src/utils/markdown.ts`: replace repeated backward token scans with a forward pass, preserving existing list-close boundaries and task indexes. Task-list processing becomes linear in token count; sanitization remains enabled.
- `web/src/components/NoteCard.vue`: memoize sanitized Markdown independently of search highlighting. Query changes no longer reparse unchanged notes even above the shared 16,384-code-unit cache limit.
- `web/src/router/index.ts`: dynamically import route components so unrelated pages are not loaded with the entry bundle.
- Add focused server/frontend regressions and `web/src/utils/markdown.bench.ts` using the existing test tools.

## Measurements

Local environment: Node 24.21.0, Linux arm64, two reported CPUs; isolated MongoDB 8.3.11. Measurements are synthetic, not production acceptance or browser Web Vitals.

### Build output

| Asset | Before | After |
| --- | ---: | ---: |
| Entry JS, uncompressed | 92.11 KB | 31.63 KB |
| Entry JS, gzip | 27.63 KB | 10.59 KB |
| Entry CSS, uncompressed | 56.67 KB | 14.35 KB |

These are **entry-chunk sizes**, not total page transfer reductions. Core/Markdown vendor chunks remain; requested routes download their own chunks. A clean browser smoke test confirmed that the private-note and 404 routes do not load NotesView, and 404 does not load the Markdown vendor chunk.

### Uncached Markdown render + sanitization

Run from the repository root:

```sh
npm --prefix web exec -- vitest bench --run --root web
```

| Fixture | Before mean | After mean |
| --- | ---: | ---: |
| 500 tasks | 77.38 ms | 78.79 ms |
| 500 plain list items | 33.62 ms | 31.40 ms |
| 2,000 tasks | 351.51 ms | 286.57 ms |
| 2,000 plain list items | 196.01 ms | 114.47 ms |

One sequential before/after run, with 5–16 samples per case. Task-list relative error reached roughly 31%; the 500-task case has no demonstrated improvement. Treat larger-list gains as indicative, not a guaranteed percentage or CI threshold. DOM sanitization remains a substantial part of total work.

### Search baseline, unchanged implementation

Ran `scripts/benchmark-search.js --size=10000 --repetitions=30` with `MONGODB_URL` explicitly pointed at a disposable MongoDB container and synthetic database. **Do not run it against a production/default database**: it creates indexes and inserts/deletes benchmark fixtures. The temporary container and its volumes were cleaned up.

| Scenario | Service p50 | Service p95 |
| --- | ---: | ---: |
| Hashtag | 1.08 ms | 2.13 ms |
| Chinese keyword, regex | 1.44 ms | 2.23 ms |
| Multi-term regex | 1.42 ms | 2.18 ms |
| Single keyword, text | 6.50 ms | 8.13 ms |
| No-match stemming query, regex | 33.90 ms | 366.16 ms |
| Same term, text stemming | 2.93 ms | 6.21 ms |

The no-match regex case examined 9,500 documents. Text search has different tokenization, stemming and matching semantics, so silently replacing regex is not a safe performance fix. These timings cover the application service, not HTTP/network latency or concurrency.

## Validation and remaining limits

- `npm test`: **468 passed**, using the repository's temporary MongoDB runner.
- `npm --prefix web test`: **92 passed**; jsdom emitted navigation-not-implemented diagnostics, but no tests failed.
- `npm --prefix web run typecheck`, `npm run build`: passed.
- Browser smoke: all five routes rendered expected synthetic content/404 without page exceptions, using built assets, mocked APIs and a proxy-free preview server. This is not a live authentication/API end-to-end test.
- No production load test, mobile-device trace, concurrent-user stress test, or representative large-attachment import/export benchmark was performed.
- Retained existing compound indexes, bounded Markdown cache and proxy compression/static-cache design. Do not add Redis, a search service or speculative indexes without representative query/load evidence.
- Remaining candidates: expensive no-match regex/deep pagination, external URL enrichment latency, and whole-dataset import/export memory use. Measure representative workloads before changing matching behavior, enrichment freshness, pagination contracts or rollback-sensitive import code.
