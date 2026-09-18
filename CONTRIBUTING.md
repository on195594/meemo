# Contributing

Contributions are released under the project's MIT License.

## Setup

See the [Development](README.md#development) section in `README.md` for environment requirements, build steps, and development commands.

## Change guidelines

- Keep HTTP handling in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`.
- Follow the existing CommonJS, Promise-first `async`/`await` style and `.editorconfig`; do not reformat unrelated code.
- Do not commit generated `public/`, dependency `node_modules/`, local account files, or attachments.
- Add or update a focused test under `src/test/` for non-trivial server behavior.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`, or `docs/RELEASE_CHECKLIST.md` when behavior, deployment, runbooks, or architecture change.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.

## Changes and pull requests

For the single-maintainer repository, make focused commits directly on `master` after the relevant checks pass. External contributors should fork the repository, create a focused branch, and open a pull request describing the problem, solution, and checks run. If branch protection is re-enabled, follow [`docs/BRANCH_PROTECTION.md`](docs/BRANCH_PROTECTION.md) instead.

1. Make one logically scoped change.
2. Run `npm test`, `npm --prefix web test`, `npm run build`, `npm --prefix web run typecheck`, and `docker build .` when container behavior changes. If API contracts changed, run `npm run api:generate` and commit updated types.
3. Use a short imperative commit subject; Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` are preferred.

CI builds and tests images locally on pull requests. Pushes to `master` and published releases automatically publish multi-arch images to the GitHub Container Registry (`ghcr.io/on195594/meemo`).
