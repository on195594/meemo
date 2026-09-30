# Documentation index

## Current contracts and guidance

- [Project README](../README.md): setup, configuration, directory map, and development commands.
- [Architecture](ARCHITECTURE.md): implemented boundaries, runtime flow, persistence, and endpoint groups.
- [Long-term architecture](LONG_TERM_ARCHITECTURE.md): normative architectural constraints and complexity budget; planned work is not proof of implementation.
- [OpenAPI specification](openapi.yaml): authoritative HTTP contract. Regenerate `types/generated/api-types.ts` with `npm run api:generate` when it changes.
- [Contribution guide](../CONTRIBUTING.md): coding and validation workflow.
- [Agent instructions](../AGENTS.md): repository-specific working rules.
- [Security policy](../SECURITY.md): vulnerability reporting and support policy.

## Operations and validation

- [Backup and restore](BACKUP_RESTORE.md): matched backups, explicit `verify:restore` synthetic recovery checks, and production rollback.
- [Release checklist](RELEASE_CHECKLIST.md): authorization, migration, validation, RC publication, deployment, and rollback gates.
- [Branch protection reference](BRANCH_PROTECTION.md): policy if protection is enabled; the single-maintainer workflow permits direct commits.
- [Dependency security](DEPENDENCY_SECURITY.md): audit procedure and recorded findings; rerun the audit rather than assuming recorded results are current.
- [Search baseline](SEARCH_BASELINE.md): performance measurements and the explicit `verify:search:relevance` synthetic corpus; labels remain pending human review and known gaps are reported, not hidden.
- [Nginx reference](nginx-reverse-proxy.conf): reverse-proxy configuration template; adapt it before use.

## Plans and review snapshots

- [Architecture evolution roadmap](roadmaps/2026-09-18-architecture-evolution.md): staged work and acceptance criteria.
- [MD3 review and recommendations](reviews/meemo-md3-review-and-fix-recommendations.md): review findings and proposed fixes.

Keep new plans in `roadmaps/` and review reports in `reviews/`. These documents retain design rationale; confirm implementation against source and tests before treating a recommendation as current behavior.

## Directory maintenance

- Keep runtime source in `src/`, browser source in `web/src/`, tests beside frontend source or in `src/test/`, and automation in `scripts/`.
- Root entry points (`app.js`, `runTests`, `localdevelopment`, `start.sh`, `deploy.sh`) are intentional. In particular, `start.sh` is the Docker command, not a discarded legacy script.
- Retain offline migration and retirement tooling while backup/restore and release runbooks depend on it. Being unused by the HTTP server does not make a migration script dead code.
- `types/api.d.ts` and `types/index.d.ts` form the package's declared TypeScript entry point; generated HTTP types live separately in `types/generated/`.
- `npm run build` produces staging output in `web/dist/` and the Express-served copy in `public/`. Both are ignored and reproducible; `npm run build:web` updates only the staging output.
- Keep dependencies, account files, attachments, database files, backups, and migration evidence out of commits. Do not treat ignored local state as disposable temporary files.
- Remove code only after checking runtime, test, script, build, and declared-package callers. Prefer removing unused entry points over moving working modules for appearance.

Update the relevant current document when behavior changes, and keep links in this index and the project README synchronized. Historical findings should remain clearly distinguishable from current contracts.
