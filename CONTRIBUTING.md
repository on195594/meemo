# Contributing

Contributions are released under the project's MIT License.

## Setup

See [Development](README.md#development) for setup requirements and commands, and the [documentation index](docs/README.md) for current contracts and runbooks.

## Change guidelines

- Keep HTTP concerns in `src/http/`, business logic in `src/services/`, persistence in `src/database/`, and filesystem storage in `src/storage/` (`connect-mongo` session config lives in `src/http/session.js`).
- Preserve CommonJS with Promise-first `async`/`await` and `.editorconfig` formatting; do not reformat unrelated code.
- Never commit generated build output (`public/`, `web/dist/`), `node_modules/`, secrets, local accounts, attachments, or database files.
- Test server/script behavior in `src/test/` (Mocha) and Vue components/composables/routes in `web/src/` (Vitest); keep build/typecheck checks free of source-string/file-inventory duplication and preserve auth, security, accessibility, and recovery invariants when refactoring tests.
- Update relevant docs (`README.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`, `docs/RELEASE_CHECKLIST.md`) when behavior, contracts, or operations change.
- Report vulnerabilities via [SECURITY.md](SECURITY.md), never in public issues.

## Changes and pull requests

For single-maintainer work, commit focused changes directly on `master` after relevant checks pass (Conventional Commits like `fix:`, `feat:`, `docs:` preferred). External contributors should fork, branch, and open a PR summarizing the change and verification run.

CI validates PRs and pushes to `master` (including multi-arch container builds without publishing). The manual **RC release** workflow publishes immutable RC images to GHCR; see [Deployment and releases](docs/RELEASE_CHECKLIST.md).

## Validation

Run only the checks relevant to what changed:

| Change | Checks |
| --- | --- |
| Documentation or metadata | `git diff --check` and relative Markdown links |
| Server or scripts | `npm test` |
| Frontend | `npm --prefix web run typecheck`, `npm --prefix web test`, `npm run build` |
| API contract (`docs/openapi.yaml`) | `npm run api:generate`, verify `types/generated/api-types.ts`, run affected server/frontend checks |
| Dockerfile / container | `docker build .`; Compose smoke check when runtime spans services |
| `deploy.sh` only | `bash -n deploy.sh` and `npx --no-install mocha src/test/deploy-test.js` |

`npm run verify` runs the complete quality + Compose integration gate in CI. Routine host deployment uses [Deployment and releases](docs/RELEASE_CHECKLIST.md#routine-host-deployment) and updates only the Meemo container.
