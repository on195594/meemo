# AGENTS.md

Instructions for coding agents working in this repository.

## Project overview

Meemo is a Node.js/Express notes application with a browser frontend, MongoDB persistence, filesystem attachments, username/password authentication, and Docker deployment support.

## Source map

- `app.js`: process entry point, middleware, sessions, authentication mode, route registration, and MongoDB startup.
- `src/lifecycle.js`: worker management, MongoDB connection pool lifecycle, and graceful shutdown sequencing.
- `src/http/`: HTTP routing, input validation, authentication middleware, and error responses.
- `src/services/`: application behavior for auth, things, attachments, sharing, settings, health, and import/export.
- `src/storage/`: persistent attachment filesystem access.
- `src/database/`: MongoDB access for things, tags, settings, users, and sessions.
- `src/users.js`: account repository abstraction and bcrypt password handling.
- `types/`: domain TypeScript definitions (`types/api.d.ts`) and OpenAPI generated types (`types/generated/api-types.ts`).
- `scripts/`: historical v1-to-v2 migration tools, retirement preflight, business-readiness verifier, benchmark, and attachment GC.
- `src/test/`: Mocha server tests.
- `web/`: modern Vue 3 + Vite + TypeScript browser application.
- `public/`: generated frontend output; never edit or commit it.
- `docs/ARCHITECTURE.md`: component boundaries, API contracts, and runtime flow.
- `docs/BACKUP_RESTORE.md`: production backup, disaster recovery, and verification runbooks.
- `docs/BRANCH_PROTECTION.md`: reference master branch protection and check policies (disabled for single-maintainer development).
- `docs/DEPENDENCY_SECURITY.md`: production dependency security audit and vulnerability remediation map.
- `docs/RELEASE_CHECKLIST.md`: release candidate validation, deployment, and rollback checklist.
- `docs/openapi.yaml`: authoritative OpenAPI 3.0 specification.
- `Dockerfile`, `docker-compose.yml`: deployment and packaging.

## Working rules

1. Read the relevant route, logic, database, frontend, and test callers before changing behavior.
2. Keep HTTP concerns in `src/http/`, shared behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`.
3. Prefer the smallest root-cause change. Reuse existing code and dependencies; do not add speculative abstractions.
4. Preserve CommonJS and use Promise-first `async`/`await`; add callback compatibility only when an existing script or test still requires it.
5. Follow `.editorconfig` and nearby style. Use four-space JavaScript indentation and avoid unrelated formatting.
6. Never weaken authentication, authorization, input validation, session handling, or error handling for convenience.
7. Do not log or commit passwords, password hashes, session secrets, local account data, attachments, or imported notes.
8. Preserve unrelated user changes. Do not delete ignored or untracked files unless explicitly asked.
9. Single-maintainer workflow: As a personal project maintained by an individual, branch protection on `master` is removed to maximize efficiency. Direct commits and pushes to `master` are preferred after passing the narrowest validation checks, without requiring pull requests.

## Generated and local-only files

Do not commit or hand-edit:

- `node_modules/`
- `public/`
- `.users.json`, `users.json`
- `attachments/`, `storage/`, `data/`, `database/`

## Commands

```sh
npm ci                         # install locked dependencies
npm --prefix web ci            # install locked web dependencies
npm run build                  # compile web/ into public/
npm test                       # run tests using a temporary MongoDB container
./localdevelopment             # run the app with a development MongoDB container
npm start                      # run only Node; MongoDB must already be available
npm run api:generate           # generate TypeScript types from docs/openapi.yaml
npm --prefix web run typecheck # typecheck Vue 3 frontend
npm --prefix web test          # run frontend behavior tests with Vitest
docker compose up --build -d
```

`npm test`, local development, and Compose require Docker. Do not replace the lockfile or upgrade dependencies unless dependency work is part of the request.

## Validation

Run the narrowest checks that cover the change:

- Documentation or metadata only: `git diff --check` and verify relative Markdown links.
- Frontend changes: `npm run build`, `npm --prefix web run typecheck`, and `npm --prefix web test`.
- API contract changes: `npm run api:generate` and verify `types/generated/api-types.ts` is in sync.
- Server, authentication, persistence, import/export, or API changes: `npm test`.
- Docker or deployment changes: `docker build .`; use the Compose health/login flow when behavior spans services.

Add or update a focused test under `src/test/` for non-trivial server behavior. Do not add a new test framework.

## Documentation and releases

Update documentation with behavior changes:

- `README.md`: setup, authentication, configuration, and deployment.
- `docs/ARCHITECTURE.md`: boundaries, data flow, or endpoint groups.
- `docs/BACKUP_RESTORE.md`: production backup, disaster recovery, and verification runbooks.
- `docs/RELEASE_CHECKLIST.md`: release candidate validation, deployment, and rollback checklist.
- `CONTRIBUTING.md`: contributor workflow and standards.
- `SECURITY.md`: reporting or support policy.

Use short imperative commit subjects. Conventional Commit prefixes such as `fix:`, `feat:`, `docs:`, `test:`, and `chore:` are preferred.
