# Documentation index

## Current contracts and guidance

- [Project README](../README.md): setup, configuration, directory map, and development commands.
- [Architecture](ARCHITECTURE.md): implemented boundaries, runtime flow, persistence, and endpoint groups.
- [Long-term architecture](LONG_TERM_ARCHITECTURE.md): normative architectural constraints and complexity budget; planned work is not proof of implementation.
- [OpenAPI specification](openapi.yaml): authoritative HTTP contract. Regenerate `types/generated/api-types.ts` with `npm run api:generate` when it changes.
- [Contribution guide](../CONTRIBUTING.md): coding and validation workflow.
- [Product specification](../PRODUCT.md): target user persona, scope, positioning, and product boundaries.
- [Design system](../DESIGN.md): Material Design 3 and Google Keep tokens, color palette, and component specs.
- [Agent instructions](../AGENTS.md): repository-specific working rules.
- [Security policy](../SECURITY.md): vulnerability reporting and support policy.
- [Gemini assistant](GEMINI_ASSISTANT.md): implemented, default-disabled MCP read/write tools, OAuth scopes, configuration, privacy, revocation and recovery.

## Operations and validation

- [Backup and restore](BACKUP_RESTORE.md): matched backups, explicit `verify:restore` synthetic recovery checks, and production rollback.
- [Release checklist](RELEASE_CHECKLIST.md): authorization, migration, validation, RC publication, deployment, and rollback gates.
- [Branch protection reference](BRANCH_PROTECTION.md): policy if protection is enabled; the single-maintainer workflow permits direct commits.
- [Dependency security](DEPENDENCY_SECURITY.md): audit procedure and recorded findings; rerun the audit rather than assuming recorded results are current.
- [Search baseline](SEARCH_BASELINE.md): performance measurements and the explicit `verify:search:relevance` synthetic corpus; labels remain pending human review and known gaps are reported, not hidden.
- [Nginx reference](nginx-reverse-proxy.conf): reverse-proxy configuration template; adapt it before use.

## Plans and review snapshots

- [Gemini assistant integration plan](roadmaps/2026-10-12-gemini-assistant-integration.md): historical staged MCP + OAuth proposal; current read/write implementation is documented in the assistant guide, and real Meemo client acceptance passed by maintainer manual test (2026-10-22).
- [AGY integration-plan review](reviews/2026-10-12-gemini-assistant-agy-review.md): independent CLI review, verified findings, plan revisions, and scoped PASS on recheck; not implementation acceptance.
- [AGY MCP implementation review](reviews/2026-10-12-gemini-mcp-implementation-agy-review.md): real independent CLI review, SDK evidence-based adjudication and scoped recheck PASS; not production acceptance.
- [Codex MCP review and fixes](reviews/2026-10-12-gemini-mcp-codex-review.md): four verified findings repaired, full candidate recheck PASS_WITH_NOTES, local regressions and isolation evidence; not production acceptance.

- [Architecture evolution roadmap](roadmaps/2026-09-18-architecture-evolution.md): staged work and acceptance criteria.
- [MD3 review and recommendations](reviews/meemo-md3-review-and-fix-recommendations.md): review findings and proposed fixes.
- [Impeccable UI audit and polish](reviews/2026-10-08-impeccable-ui-audit.md): scoped UI findings, implemented refinements, modal focus hardening, and synthetic browser validation.
- [Performance optimization snapshot](reviews/2026-09-30-performance-optimization.md): implemented optimizations, synthetic before/after measurements, validation and remaining limits.

Keep new plans in `roadmaps/` and review reports in `reviews/`. These documents retain design rationale; confirm implementation against source and tests before treating a recommendation as current behavior. Dated test counts and reviewer verdicts describe their original candidate, not later cleanup changes. Private `/tmp` review snapshots/logs and `.playwright-mcp` captures are disposable and may no longer exist; durable conclusions live in these reports.

## Directory maintenance

- Keep runtime source in `src/`, browser source in `web/src/`, tests beside frontend source or in `src/test/`, and automation in `scripts/`.
- Root entry points (`app.js`, `runTests`, `localdevelopment`, `start.sh`, `deploy.sh`) are intentional. In particular, `start.sh` is the Docker command, not a discarded legacy script.
- Retain offline migration and retirement tooling while backup/restore and release runbooks depend on it. Being unused by the HTTP server does not make a migration script dead code.
- `types/api.d.ts` and `types/index.d.ts` form the package's declared TypeScript entry point; generated HTTP types live separately in `types/generated/`.
- `npm run build` produces staging output in `web/dist/` and the Express-served copy in `public/`. Both are ignored and reproducible; `npm run build:web` updates only the staging output.
- Keep dependencies, account files, attachments, database files, backups, and migration evidence out of commits. Do not treat ignored local state as disposable temporary files. Clean only identified logs/captures/review scratch copies after preserving conclusions; do not blanket-delete ignored directories, shared `/tmp`, or local data.
- Keep Vue behavior tests with `web/src/`; server tests own HTTP/static delivery, authentication, persistence and verification tools. Obsolete Vue source-string, duplicate bundle-presence, and completed frontend-retirement inventory assertions are not a second frontend test suite. HTTP/static/history coverage lives in `src/test/http-static-test.js`.
- Remove code only after checking runtime, test, script, build, and declared-package callers. Prefer removing unused entry points over moving working modules for appearance.

Update the relevant current document when behavior changes, and keep links in this index and the project README synchronized. Historical findings should remain clearly distinguishable from current contracts.
