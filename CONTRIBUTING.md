# Contributing

Contributions are released under the project's MIT License.

## Setup

See the [Development](README.md#development) section in `README.md` for environment requirements, build steps, and development commands. Use the [documentation index](docs/README.md) for current contracts, runbooks, plans, and review snapshots.

## Change guidelines

- Keep HTTP handling in `src/http/`, application behavior in `src/services/`, domain persistence in `src/database/`, and attachment filesystem access in `src/storage/`. Session persistence is configured with `connect-mongo` in `src/http/session.js`.
- Follow the existing CommonJS, Promise-first `async`/`await` style and `.editorconfig`; do not reformat unrelated code.
- Do not commit generated `public/` or `web/dist/`, dependency `node_modules/` or `web/node_modules/`, local account files, attachments, or database data.
- Add or update a focused test under `src/test/` for non-trivial server or verification-script behavior. Test frontend components, stores and routes under `web/src/` with Vitest; do not check Vue source strings, file existence or bundle output in Mocha. Build/typecheck validate frontend compilation; `src/test/http-static-test.js` covers HTTP/static/history behavior; do not retain completed frontend-retirement inventory checks. Preserve authentication, authorization, accessibility and recovery regressions when consolidating tests.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`, or `docs/RELEASE_CHECKLIST.md` when behavior, deployment, runbooks, or architecture change.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.

## Changes and pull requests

For the single-maintainer repository, make focused commits directly on `master` after the relevant checks pass. External contributors should fork the repository, create a focused branch, and open a pull request describing the problem, solution, and checks run.

1. Make one logically scoped change.
2. Run the relevant [validation](#validation) and report any checks not completed.
3. Use a short imperative commit subject; Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` are preferred.

CI validates pull requests and pushes to `master`, including local multi-architecture image builds; it does not publish images. Publication is a separate, manually dispatched **RC release** workflow from the current `master` head. It reruns validation, publishes an immutable RC image to GHCR, then creates a GitHub prerelease without moving stable aliases. See the [release checklist](docs/RELEASE_CHECKLIST.md).

## Validation

Run the checks for the parts changed; unrelated checks are not a prerequisite for a focused commit.

| Change | Checks |
| --- | --- |
| Documentation or metadata | `git diff --check` and relative Markdown links |
| Server or scripts | `npm test` |
| Frontend | `npm --prefix web run typecheck`, `npm --prefix web test`, `npm run build` |
| API contract | `npm run api:generate`, include updated types, and run affected server/frontend checks |
| Dockerfile/container | `docker build .`; Compose health/login when behavior spans services |
| Deployment orchestration only | `bash -n deploy.sh` and `npx --no-install mocha src/test/deploy-test.js`; no production restart |

`npm run verify` runs the complete quality and isolated Compose gate. It already includes generation/type checks, frontend tests/build, and backend tests; do not rerun its individual steps for the same unchanged candidate.

Routine host deployment uses the shorter [deployment flow](docs/RELEASE_CHECKLIST.md#routine-host-deployment), reuses relevant validation, and only updates Meemo. MongoDB is independently operated and shared with travel-cards.
