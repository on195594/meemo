# Contributing

Contributions are released under the project's MIT License.

## Setup

See the [Development](README.md#development) section in `README.md` for environment requirements, build steps, and development commands. Use the [documentation index](docs/README.md) for current contracts, runbooks, plans, and review snapshots.

## Change guidelines

- Keep HTTP handling in `src/http/`, application behavior in `src/services/`, domain persistence in `src/database/`, and attachment filesystem access in `src/storage/`. Session persistence is configured with `connect-mongo` in `src/http/session.js`.
- Follow the existing CommonJS, Promise-first `async`/`await` style and `.editorconfig`; do not reformat unrelated code.
- Do not commit generated `public/` or `web/dist/`, dependency `node_modules/` or `web/node_modules/`, local account files, attachments, or database data.
- Add or update a focused test under `src/test/` for non-trivial server or verification-script behavior. Prefer frontend behavior tests under `web/src/`; do not repeat file-existence or bundle assertions already covered by typecheck, build, and SPA cutover checks.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`, or `docs/RELEASE_CHECKLIST.md` when behavior, deployment, runbooks, or architecture change.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.

## Changes and pull requests

For the single-maintainer repository, make focused commits directly on `master` after the relevant checks pass. External contributors should fork the repository, create a focused branch, and open a pull request describing the problem, solution, and checks run. If branch protection is re-enabled, follow [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md) instead.

1. Make one logically scoped change.
2. Run the narrowest relevant checks: `npm test` for server/script changes; frontend typecheck, Vitest, and build for frontend changes; `docker build .` for container changes. If API contracts changed, run `npm run api:generate` and include updated types. Use `npm run verify` for the full quality and isolated Compose gate. Changes to recovery/search verification also require the separate `npm run verify:restore` / `npm run verify:search:relevance` commands; these use synthetic data, and search labels still require human review.
3. Use a short imperative commit subject; Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` are preferred.

CI validates pull requests and pushes to `master`, including local multi-architecture image builds; it does not publish images. Publication is a separate, manually dispatched **RC release** workflow from the current `master` head. It reruns validation, publishes an immutable RC image to GHCR, then creates a GitHub prerelease without moving stable aliases. See the [release checklist](docs/RELEASE_CHECKLIST.md).
