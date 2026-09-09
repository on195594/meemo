# Contributing

Contributions are released under the project's MIT License.

## Setup

Requirements are Node.js 18 or newer, npm, and Docker.

```sh
npm ci
npm run build
npm test
```

`npm test` starts and removes a temporary MongoDB container. For interactive development, run `./localdevelopment`; use `npm run build` again after frontend changes.

## Change guidelines

- Keep HTTP handling in `src/routes.js`, application behavior in `src/logic.js`, and persistence in `src/database/`.
- Follow the existing JavaScript style and `.editorconfig`; do not reformat unrelated code.
- Do not commit generated `public/`, dependency `node_modules/`, local account files, or attachments.
- Add or update a focused test under `src/test/` for non-trivial server behavior.
- Update `README.md` or `docs/ARCHITECTURE.md` when behavior, deployment, or architecture changes.
- Report vulnerabilities according to [SECURITY.md](SECURITY.md), not in a public issue.

## Pull requests

1. Fork and clone `https://github.com/on195594/meemo`.
2. Create a focused branch from `master`.
3. Make one logically scoped change.
4. Run `npm test`, `npm run build`, and `docker build .` when container behavior changes.
5. Use a short imperative commit subject; Conventional Commit prefixes such as `fix:`, `feat:`, and `docs:` are preferred.
6. Open a pull request describing the problem, the solution, and the checks run.

CI builds and tests images locally. Repository workflows do not publish images to a remote registry.
