# Search baseline

Status: `PASS` for the recorded synthetic performance baseline. A reproducible, agent-authored relevance sample is now available; it currently has no known gaps, and human relevance review remains `NOT_RUN` (see the maintainer review checklist at the end).

## Reproduction

```sh
MONGODB_URL=mongodb://127.0.0.1:27017/meemo-benchmark \
  node scripts/benchmark-search.js --size=1000 --warmup=1 --repetitions=2
```

The benchmark creates deterministic data, exercises regex/text/tag/Chinese/archived queries, records MongoDB `executionStats`, and removes its owner-scoped fixture afterward. Do not point it at a shared or production database.

## Reference run

Run date: 2026-09-18

- Node: `v24.21.0`
- MongoDB: `8.3.11`
- Platform: `linux/arm64`
- CPUs: `2`
- Fixture: `1,000` Things, page size `10`
- Warmup/repetitions: `1/2`

| Scenario | p50 ms | p95 ms | Mongo docs examined |
| --- | ---: | ---: | ---: |
| single-keyword | 2.239 | 13.431 | 86 |
| chinese-keyword | 1.710 | 2.079 | 86 |
| multi-term | 2.418 | 13.277 | 86 |
| tag | 1.447 | 6.823 | 10 |
| archived | 1.844 | 2.743 | 10 |
| single-keyword-text | 1.986 | 2.789 | 200 |
| multi-term-text | 2.332 | 2.504 | 200 |
| stemming-regex | 50.435 | 52.615 | 950 |
| stemming-text | 1.783 | 5.713 | 66 |
| tag-and-keyword-text | 3.775 | 5.727 | 200 |

This is a comparison baseline, not an SLO. The `stemming-regex` miss is the current known expensive case; optimize it only after a representative relevance sample confirms it matters. M4 AI work is not justified by this performance run alone.

## Synthetic relevance sample (M3-01)

```sh
npm ci
npm run verify:search:relevance
```

This entry point reuses `scripts/benchmark-search.js --relevance` and its `thing-service.getAll` path. It creates its own uniquely labeled MongoDB container, publishes only a random loopback port, seeds a new empty `meemo_relevance_*` database, and cleans up afterward. It rejects additional CLI arguments and does not use `MONGODB_URL` to select a target. SIGINT/SIGTERM trigger controlled cancellation and ownership-checked cleanup (exit 130/143), including the MongoDB container's anonymous volumes; forced termination/daemon failure cannot guarantee cleanup. The original performance command above is unchanged in scope and still requires an explicitly isolated database.

The versioned corpus in [`scripts/fixtures/search-relevance.json`](../scripts/fixtures/search-relevance.json) contains 18 synthetic notes and 29 independently specified queries. Labels were authored by the coding agent, not generated from current query results, and are **pending human review**. No production notes were copied. Coverage includes Chinese substrings/tags, English stemming, regex AND versus text OR, quoted phrases, exact tags, mixed filters, escaped URLs, wikilinks, case/accent normalization, sticky/relevance/tag-weight ranking, stable pagination, owner isolation, archive/trash visibility, and negative queries.

Each case defines the expected result-ID set and, where needed, a ranked prefix. The evaluator reports actual IDs, missing/unexpected IDs, ranking checks, recall/precision at the configured result limit, and a single-query service latency. Mean recall includes only cases with positive labels, giving each case equal weight. These timings are diagnostic, not p95 measurements or a representative performance benchmark. Stable-ID service readback is checked; browser opening/back navigation remains a separate acceptance layer.

Result semantics:

- `PASS`: all labeled sets/ranking checks passed.
- `PASS_WITH_KNOWN_GAPS`: all strict cases passed, but an explicitly documented expected hit is still missing. This exits zero so the recorded baseline is runnable; it is not a complete relevance pass.
- `FAIL`: an undocumented miss, unexpected result, ranking regression, malformed corpus, unsafe target, isolation/visibility violation, or cleanup error. The command exits nonzero. Known gaps never excuse owner leakage, visibility failures, new false positives, or ranking regressions.

Initial local candidate run: 29/30 cases passed; the only miss was `chinese-backup-text` (`备份` in `text` mode). On 2026-10-22 the maintainer removed that case: it encoded a preference that real notes do not exercise, while `chinese-backup-regex` still covers Chinese substring search. The corpus now has 29 cases and no known gaps; the known-gap mechanism stays covered by a synthetic case in `src/test/search-relevance-test.js`.

Before optimizing M3-02, have a maintainer review the corpus/labels and add representative, explicitly approved examples. Keep AND/OR, owner, trash, and ranking contracts separate from desired semantic improvements; do not change expected IDs merely to make a failing implementation pass. The report includes dataset SHA-256, environment, source commit, and dirty-tree state; rebind evidence after committing. This sample alone does not authorize production data sampling, an external search service, AI calls, or a vector database.

## Maintainer label review (M3-01 human review)

Status: `NOT_RUN` — awaiting maintainer decisions. A coding agent prepared this checklist; it does not count as human review.

Rerun 2026-10-22 after removing `chinese-backup-text`: `PASS`, 29/29, mean recall 100%, dataset SHA-256 `014d32b4…73696e` (uncommitted tree on `c71897d`).

Most cases are contract checks (owner isolation, archive/trash visibility, AND vs OR, exact tag, pagination, literal URL). Approve those unless the product behavior itself should change. The following labels encode product **preferences** and need an explicit maintainer decision:

| Case | Current label | Decision needed |
| --- | --- | --- |
| `english-stemming-regex` | `writes` in `regex` mode finds nothing | Accept that regex mode has no stemming? |
| `regex-and-does-not-become-or` / `text-or` | Regex mode requires all terms; text mode returns any term | Accept the different semantics between the two modes? |
| `sticky-before-relevance` / `text-or` prefix | Pinned notes rank above higher-scoring unpinned ones | Should pinned notes outrank relevance? |
| `tag-weight-before-content` | A tag hit outranks a content-only hit | Accept the tag weight? |
| `wikilink-label` | `[[Project Atlas\|Custom label]]` finds the note even though its displayed label is `Atlas` | Should wikilink searches match only the target? |
| `accent-folding` | `cafe` finds `Café` in text mode | Accept accent-insensitive search? |

To record the review: set each decision (approve / relabel with a reason) in this table, update `provenance` in `scripts/fixtures/search-relevance.json` to name the reviewer and date, rerun `npm run verify:search:relevance` on a clean commit, and change the status above to `PASS` with the reviewer and date. Add representative examples from your own usage as new synthetic cases, never copied production notes.
