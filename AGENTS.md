# AGENTS.md

Instructions for coding agents working in Meemo.

## Project Overview

Meemo is a lightweight Node.js/Express notes app with a Vue 3 frontend, MongoDB persistence, filesystem attachments, and Docker deployment.

## Source Map

- `app.js` & `src/lifecycle.js`: Process lifecycle, worker management, and HTTP/MongoDB startup.
- `src/http/`: Express routing, input validation, auth middleware, and API handlers.
- `src/services/`: Domain logic (notes, tags, attachments, sharing, auth, MCP tools).
- `src/database/`: MongoDB persistence layer.
- `src/storage/`: Filesystem attachments.
- `src/users.js`: User accounts and bcrypt password handling.
- `web/`: Modern Vue 3 + TypeScript frontend (`public/` and `web/dist/` are generated build output; do not hand-edit).
- `src/test/` & `web/src/`: Backend and frontend test suites.
- `docs/`: Reference specs (`openapi.yaml`), architecture, and runbooks (see `docs/README.md`).

## Core Rules

1. **Investigate first**: Inspect relevant callers and tests before modifying code.
2. **Layer separation**: Keep HTTP concerns in `src/http/`, business logic in `src/services/`, persistence in `src/database/`, files in `src/storage/`.
3. **No over-engineering**: Make the smallest root-cause change. Reuse existing code; do not add speculative abstractions, unrequested scripts, or extra layers. Stop as soon as the task works.
4. **Style**: Preserve CommonJS with Promise-first `async`/`await`. Follow `.editorconfig` (4-space JS indentation).
5. **Security & State**: Never weaken auth or validation. Never commit secrets, hashes, or local data. Preserve unrelated user changes.
6. **Single-maintainer workflow**: Direct commits and pushes to `master` with Conventional Commits (`feat:`, `fix:`, etc.) after targeted verification. No PRs required.

## Targeted Validation

Run only the narrowest check relevant to your change:

- **Frontend single test**: `npx --prefix web vitest run web/src/path/to/file.spec.ts` (fast)
- **Frontend types**: `npm --prefix web run typecheck`
- **Frontend bundle** (only when bundling or preparing release): `npm run build`
- **Backend / Database / API**: `npm test` (starts temporary MongoDB container)
- **API Spec Sync**: `npm run api:generate` (when changing `docs/openapi.yaml`)
- **Deploy Script Check**: `bash -n deploy.sh && npx --no-install mocha src/test/deploy-test.js`

**Do not run heavy CI suites (`npm run verify` / Compose integration) unless explicitly requested** — they rebuild containers and are too heavy for a 2-vCPU host.

## Deployment

- Host deployment requires explicit user authorization.
- Use `./deploy.sh`: updates only the Meemo container (MongoDB is shared and deployed independently).
- Docs or test-only changes do not require rebuilding or redeploying.
