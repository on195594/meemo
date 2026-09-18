# Search baseline

Status: `PASS` for a repeatable synthetic performance baseline; semantic relevance review remains `NOT_RUN`.

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
