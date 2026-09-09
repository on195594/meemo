# AGENTS.md

Instructions for coding agents working in this repository.

## Project overview

Meemo is a Node.js/Express notes application with a browser frontend, MongoDB persistence, filesystem attachments, username/password authentication, and Docker deployment support.

## Source map

- `app.js`: process entry point, middleware, sessions, authentication mode, route registration, and MongoDB startup.
- `src/routes.js`: HTTP input/output and route handlers.
- `src/logic.js`: application behavior.
- `src/database/`: MongoDB access for things, tags, and settings.
- `src/users.js`: local account file and bcrypt password handling.
- `src/test/`: Mocha server tests.
- `frontend/`: browser source.
- `public/`: generated frontend output; never edit or commit it.
- `docs/ARCHITECTURE.md`: component boundaries and runtime flow.
- `Dockerfile`, `docker-compose.yml`: deployment and packaging.

## Working rules

1. Read the relevant route, logic, database, frontend, and test callers before changing behavior.
2. Keep HTTP concerns in `src/routes.js`, shared behavior in `src/logic.js`, and persistence in `src/database/`.
3. Prefer the smallest root-cause change. Reuse existing code and dependencies; do not add speculative abstractions.
4. Preserve the existing CommonJS, callback-based style unless the task explicitly requires a broader migration.
5. Follow `.editorconfig` and nearby style. Use four-space JavaScript indentation and avoid unrelated formatting.
6. Never weaken authentication, authorization, input validation, session handling, or error handling for convenience.
7. Do not log or commit passwords, password hashes, session secrets, local account data, attachments, or imported notes.
8. Preserve unrelated user changes. Do not delete ignored or untracked files unless explicitly asked.

## Generated and local-only files

Do not commit or hand-edit:

- `node_modules/`
- `public/`
- `.users.json`, `users.json`
- `attachments/`, `storage/`, `data/`, `database/`

## Commands

```sh
npm ci                 # install locked dependencies
npm run build          # compile frontend/ into public/
npm test               # run tests using a temporary MongoDB container
./localdevelopment     # run the app with a development MongoDB container
npm start              # run only Node; MongoDB must already be available
docker compose up --build -d
```

`npm test`, local development, and Compose require Docker. Do not replace the lockfile or upgrade dependencies unless dependency work is part of the request.

## Validation

Run the narrowest checks that cover the change:

- Documentation or metadata only: `git diff --check` and verify relative Markdown links.
- Frontend changes: `npm run build`.
- Server, authentication, persistence, import/export, or API changes: `npm test`.
- Docker or deployment changes: `docker build .`; use the Compose health/login flow when behavior spans services.

Add or update a focused test under `src/test/` for non-trivial server behavior. Do not add a new test framework.

## Documentation and releases

Update documentation with behavior changes:

- `README.md`: setup, authentication, configuration, and deployment.
- `docs/ARCHITECTURE.md`: boundaries, data flow, or endpoint groups.
- `CONTRIBUTING.md`: contributor workflow and standards.
- `SECURITY.md`: reporting or support policy.

Use short imperative commit subjects. Conventional Commit prefixes such as `fix:`, `feat:`, `docs:`, `test:`, and `chore:` are preferred. Do not commit or push unless explicitly requested.
