# Architecture

Meemo is a small browser application served by Express and backed by MongoDB and a filesystem attachment store.

## Runtime flow

1. `app.js` provides the `startServer` runtime entry point, managed by `src/lifecycle.js` (`WorkerManager`, `DatabaseManager`, `ShutdownManager`).
2. `src/http/app.js` provides the injected `createApp` Express application factory; `src/http/session.js` and `src/http/uploads.js` own session and upload middleware.
3. `src/http/router.js` composes domain route modules under `src/http/routes/`; Zod schemas validate body, query, and path input before handlers run.
4. `src/http/responses.js` maps failures to stable API error codes without returning internal stack traces or filesystem paths.
5. `src/services/` implements authentication, notes, attachments, sharing, settings, health, and import/export behavior without depending on Express.
6. Runtime, HTTP, services, storage, user repositories, and primary database modules use Promise-first `async`/`await`; callback adapters remain only for legacy scripts and tests during migration.
7. `src/database/` reads and writes MongoDB collections (unified collections `things`, `tags`, and `settings` partitioned by `ownerId`, plus `users` and `sessions`).
8. `src/storage/local-storage.js` owns persistent attachment filesystem access.
9. `src/users.js` abstracts account storage targeting `MongoUserRepository` via `UserRepository` (legacy file and fallback repositories have been retired).
10. `web/` is compiled by Vite into the generated, ignored `public/` directory, serving as the modern Vue 3 Single Page Application with client-side routing.

The runtime reads and writes only unified collections. `things` is the online single source of truth for tag identity and usage: `/api/tags` aggregates the owner-partitioned `things.tags` arrays in real time, while the persisted `tags` collection is a migration/readiness projection. Ordinary Thing mutations (`add`, `put`, `del`) write directly and atomically to `things` without active-writer lease counters. For offline migration and release readiness verification (`verify-production-readiness.js`), a durable MongoDB write freeze gate (`things.acquireWriteFreeze` / `things.requireWriteFreeze`) blocks Thing mutations and fails closed when unverified. Tag reconstruction (`cleanupTags`) repairs Thing tag arrays using compare-and-set filters, aggregates fresh usage from `things`, and atomically swaps the replacement collection over `tags` via MongoDB's atomic `renameCollection`. Dynamic `<user>_*` collection discovery exists only in migration and read-only retirement tooling; it is not part of request handling.

Keep HTTP concerns in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`. HTTP routes must call services instead of database or filesystem APIs directly.

## Data and authentication

| Data | Storage |
| --- | --- |
| Notes, settings, sessions | MongoDB (unified collections: `things`, `settings`, `sessions`; `things.tags` is the single source of truth for tags; `tags` collection is a historical projection) |
| Attachments | `ATTACHMENT_DIR` partitioned by stable `userId` |
| Accounts | MongoDB `users` collection (accounts are stored solely in MongoDB; legacy user files are read-only inputs for offline migration tools only) |

Meemo supports username/password authentication only. Passwords are stored as bcrypt hashes, and successful login creates a server-side session backed by MongoDB with a stable user ID.

## Frontend state ownership

- The route query is the source of truth for search, tag, and archive filters.
- Auth, notes, and settings use explicit composable stores.
- User/session changes reset scoped state, and request generations prevent stale responses from updating a later user's store.

## HTTP surface

Routes are registered by `src/http/router.js` from `src/http/app.js`:

- `/api/register`, `/api/login`, `/api/logout`: local authentication and session management
- `/api/profile`: authenticated user identity and settings
- `/api/things`, `/api/files`, `/api/tags`, `/api/settings`: authenticated application API
- `/api/import`, `/api/export`: archive transfer with size limits and path traversal protection
- `/api/public/*`, `/api/rss/*`, `/public/*`, `/shared/*`: public streams, RSS feeds with canonical note URLs, and shared notes
- `/api/health/live`, `/api/health/ready`, `/api/healthcheck`: container and orchestration health probes

The authoritative OpenAPI 3.0 specification is maintained in `docs/openapi.yaml`, and progressive TypeScript declarations for core domain models and API contracts reside in `types/api.d.ts`.

When changing an endpoint, update its route handler, the OpenAPI specification, and the corresponding browser client call under `web/src/api/client.ts`. Add or update a test under `src/test/` for non-trivial server behavior.

## Migration and tooling

Meemo keeps v1-to-v2 migration tools for upgrades and rollback evidence; they are historical tooling, not runtime architecture:

- `scripts/migrate-users-to-mongo.js`: Migrates legacy file-based accounts to MongoDB `users` with `--dry-run`, `--apply`, and `--verify`.
- `scripts/migrate-data-to-v2.js`: Migrates dynamic legacy `<user>_*` collections into unified `things`, `tags`, and `settings` collections partitioned by `ownerId` with `--dry-run`, `--apply`, and `--verify`; every mode requires an exact expected database name, and apply/verify bind it into the independently reviewed source artifact.
- `scripts/preflight-legacy-retirement.js`: Performs a read-only, fail-closed check of environment/database binding, user identity mapping, migration state, and legacy collection ownership before operators retire compatibility data.
- `scripts/verify-production-readiness.js`: Performs end-to-end fail-closed verification of production readiness, source artifact binding, session revocation, tag integrity, attachment resolution, and authenticated readback.
- `scripts/gc-attachments.js`: Identifies and removes unreferenced orphan attachments from filesystem storage.
- `scripts/benchmark-search.js`: Benchmarks search performance across regex, text index, and hashtag filtering.
- `scripts/owner-map.js`: Shared utility for validating and resolving legacy owner-prefix mappings.

The request path must never query dynamic legacy collections. Removing source data, selecting MongoDB accounts, and ending the rollback window remain operator-controlled deployment actions.

## Performance and caching architecture

Meemo employs a multi-tiered performance strategy balancing database efficiency, server event-loop capacity, and browser rendering:

1. **MongoDB Compound ESR Indexing**:
   Queries in `src/database/things.js` follow MongoDB's Equality-Sort-Range (ESR) guideline to eliminate in-memory sort stages:
   - Default note list feed: `{ ownerId: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }` covers equality filtering on owner and archive state alongside stable compound sorting.
   - Tag-filtered feed: `{ ownerId: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }` enables index-covered multikey tag lookups without collection scans.
   - Secondary indexes (e.g. `publicId` and `modifiedAt`) are initialized concurrently using `Promise.all` at startup.

2. **Backend Fast-Path Parsing**:
   Note parsing in `src/services/thing-service.js` avoids unnecessary Markdown-it abstract syntax tree parsing when notes lack candidate URL schemes (`URL_FEATURE_PATTERN`) or hashtags (leading `#` boundary check). Plaintext notes without URLs or tags bypass heavy regex passes and link extractions.

3. **Reverse Proxy Offload (Nginx)**:
   In production, HTTP compression (Gzip/Brotli) and static asset caching are offloaded to an upstream Nginx reverse proxy ([`docs/nginx-reverse-proxy.conf`](nginx-reverse-proxy.conf)). The Node.js application serves uncompressed HTTP responses, saving CPU and event-loop time under high concurrency. Static frontend assets under `/assets/` generated by Vite include content hashes and are served with immutable, long-lived client caching headers (`max-age=31536000, immutable`).

4. **Frontend Render Memoization**:
   The Vue 3 frontend (`web/src/composables/useMarkdown.ts`) maintains an in-memory bounded LRU cache (`MAX_MARKDOWN_CACHE_SIZE = 500`, bounded to notes under 16 KiB) to avoid re-rendering Markdown DOM trees during note list filtering and tab switches.

## Verification layers

- Backend behavior and contracts: Mocha via `npm test`.
- Frontend state and request behavior: Vitest via `npm --prefix web test`.
- Type and production asset checks: `npm --prefix web run typecheck` and `npm run build`.
- Runtime integration: isolated Docker Compose smoke tests covering health, authentication, and representative writes/reads.

## Build and deployment

`npm run build` compiles the modern Vue 3 + Vite + TypeScript application in `web/` into `public/`.
`npm run build:web` compiles directly into `web/dist/`. Do not commit generated output.

The Dockerfile uses a multi-stage build (`web-builder` for `web/` and `builder` for native production dependencies), running the application as an unprivileged user while serving modern Vue 3 assets from `public/`. `docker-compose.yml` supplies MongoDB and persistent named volumes. `./deploy.sh` provides a single-command deployment helper (`docker build -t meemo:latest . && docker compose up -d`) to build local images and hot-restart the production container. Multi-platform container images (`linux/amd64` and `linux/arm64`) are automatically published to the GitHub Container Registry (`ghcr.io/on195594/meemo`) with OCI metadata, SBOM, and provenance attestations. Official backup, disaster recovery, and restore runbooks are documented in [`docs/BACKUP_RESTORE.md`](BACKUP_RESTORE.md), branch protection policies in [`docs/BRANCH_PROTECTION.md`](BRANCH_PROTECTION.md), dependency security audit in [`docs/DEPENDENCY_SECURITY.md`](DEPENDENCY_SECURITY.md), and release candidate quality gates are specified in [`docs/RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md).
