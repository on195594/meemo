# Contributing

Contributions are released under the project's MIT License.

## Setup

Requirements are Node.js 20 or newer, npm, and Docker.

```sh
npm ci
npm run build
npm test
```

`npm test` starts and removes a temporary MongoDB container. For interactive development, run `./localdevelopment`; use `npm run build` again after frontend changes.

## Change guidelines

- Keep HTTP handling in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`.
- Follow the existing CommonJS, Promise-first `async`/`await` style and `.editorconfig`; do not reformat unrelated code.
- Do not commit generated `public/`, dependency `node_modules/`, local account files, or attachments.
- Add or update a focused test under `src/test/` for non-trivial server behavior.
- Update `README.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_RESTORE.md`, or `docs/RELEASE_CHECKLIST.md` when behavior, deployment, runbooks, or architecture change.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.

## Pull requests

1. Fork and clone `https://github.com/on195594/meemo`.
2. Create a focused branch from `master`.
3. Make one logically scoped change.
4. Run `npm test`, `npm run build`, `npm --prefix web run typecheck`, and `docker build .` when container behavior changes. If API contracts changed, run `npm run api:generate` and commit updated types.
5. Use a short imperative commit subject; Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` are preferred.
6. Open a pull request describing the problem, the solution, and the checks run.

CI builds and tests images locally on pull requests. Push to `master` and published releases automatically publish multi-arch images to the GitHub Container Registry (`ghcr.io/on195594/meemo`).
