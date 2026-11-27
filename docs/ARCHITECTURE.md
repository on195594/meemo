# Architecture

Meemo is a browser-based notes manager served by Express and backed by MongoDB and filesystem attachment storage.

## Runtime flow

1. `app.js` provides the `startServer` runtime entry point, managed by `src/lifecycle.js` (`DatabaseManager`, `ShutdownManager`).
2. `src/http/app.js` provides the injected `createApp` Express factory; `src/http/session.js` and `src/http/uploads.js` own session and upload middleware.
3. `src/http/router.js` mounts domain routes under `src/http/routes/`; Zod schemas validate body, query, and path input before handlers run.
4. `src/http/responses.js` maps failures to stable API error codes without exposing stack traces or filesystem paths.
5. `src/services/` implements authentication, notes, search, attachments, sharing, RSS rendering (`src/services/rss-renderer.js`), settings, health, import/export, and MCP auth/note behavior without depending on Express.
6. Server modules use CommonJS with Promise-first `async`/`await`.
7. `src/database/` reads and writes unified MongoDB collections (`things` and `settings` partitioned by `ownerId`, plus `users`, `system_config`, and optional TTL-backed `mcp_*` collections; sessions use `connect-mongo`).
8. `src/storage/local-storage.js` owns persistent attachment filesystem access, and `src/storage/mcp-bootstrap.js` handles short-lived setup callback capture.
9. `src/users.js` delegates account persistence and bcrypt password verification to `MongoUserRepository`.
10. `npm run build` compiles `web/` with Vite into `web/dist/` and copies it to `public/`, serving the Vue 3 SPA.

`things` is the authoritative single source of truth for notes and tags (`/api/tags` aggregates `things.tags` by `ownerId` directly). Ordinary note mutations (`add`, `put`, `del`, `restore`, `purge`) write atomically to `things` with optimistic revision CAS (`expectedRevision`).

Keep HTTP concerns in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`. HTTP routes must call services rather than database or storage modules directly.

## Data and authentication

| Data | Storage |
| --- | --- |
| Notes, tags, settings, sessions | MongoDB (`things` with `things.tags`, `settings`, `sessions`) |
| Attachments | `ATTACHMENT_DIR` partitioned by stable `userId` (`<username>/` fallback kept for legacy reads/exports) |
| Accounts | MongoDB `users` collection |

Interactive login uses username/password authentication (bcrypt hashes) and creates a MongoDB-backed session with a stable user ID. Optional MCP clients use separately consented, resource-bound OAuth tokens that cannot authenticate ordinary REST endpoints.

## Optional MCP assistant

`src/http/app.js` mounts `src/http/mcp.js` protocol routes before static/SPA/session handling and cookie-authenticated connection APIs after session middleware. Enabled mode uses the official MCP v2 SDK (`@modelcontextprotocol/server`, `@modelcontextprotocol/node`, `@modelcontextprotocol/express`) for stateless Streamable HTTP and Bearer resource verification paired with Express OAuth 2.1 authorization-code/PKCE handlers in `src/http/mcp-oauth.js` (shared OAuth errors in `src/mcp-errors.js`). Configuration is fixed at startup and defaults off; reserved protocol/API paths return 404 when disabled.

A mutually exclusive setup window (`MCP_BOOTSTRAP_UNTIL`, max 30 minutes) publishes discovery and a rejection-only registration receiver via `src/storage/mcp-bootstrap.js`, capturing bounded Google callback URLs in private temporary storage for manual review before whitelist configuration.

`src/services/mcp-auth-service.js` and `src/database/mcp.js` manage grant/user/resource binding and five TTL-backed `mcp_*` collections (`clients`, `requests`, `codes`, `grants`, `tokens`), storing opaque credentials as SHA-256 hashes. `src/http/mcp-tools.js` exposes 8 tools (`search_notes`, `get_note`, `batch_get_notes`, `list_tags`, `create_note`, `update_note`, `delete_note`, `batch_delete_notes`) backed by `src/services/mcp-note-service.js` and `thing-service.js`, rejecting writes to public/shared notes and recording a single-level transient `assistant` trace cleared on the owner's next REST write or restore. See [Gemini assistant](GEMINI_ASSISTANT.md) for configuration, scopes, protocol budgets, and recovery.

## Frontend state ownership

- The route query is the source of truth for search, tag, archive, and trash filters.
- Auth, notes, and settings use explicit composable stores (`useAuth`, `useNotes`, `useSettings`); request generations discard stale out-of-order responses across user/session transitions.
- `NoteDetailModal` retains its last server snapshot and revision across filtered edits, pauses auto-save when a draft is dirty or in flight, and saves on hide/close. On `revision_conflict`, `useNotes.updateNote` re-reads and retries a field-level three-way merge unless both sides modified the same field or the competing write came from an assistant.
- Note duplication ("Make a copy") creates an independent unpinned, unarchived, private copy in Notes (duplicating the dialog draft without saving/closing the original; locked while pending).
- `web/src/utils/image.ts` downscales JPEG/PNG/WebP uploads in the browser to a 2048px long edge (converting PNG/WebP to WebP unless already `<= 2048px` and `<= 1,000,000` bytes, or smaller unchanged).
- `ActionMenu.vue` and `usePopoverPosition.ts` provide WAI-ARIA menus and viewport-clamped popovers for card/dialog actions, account menus, and color pickers.
- Unsaved composer/dialog drafts mirror to `localStorage` (`meemo_draft:*`, scoped by user ID) via a 300ms throttle (`createDraftScheduler`) and clear on explicit logout.

## Offline shell (service worker)

Production builds register `web/public/sw.js` and a web app manifest so the app starts from cached assets and supports offline note viewing:

- **Strategies**: Navigations are network-first (2.5s timeout → cached `index.html`); hashed `/assets/` are cache-first; same-origin `GET /api/*` reads are network-first with cached `meemo-data-v2` fallback. Writes, auth, `/api/files`, export/import, health, OAuth, `/assistant`, and MCP APIs bypass caching.
- **Session & cache fencing**: The worker tracks generations (`dataGeneration`, `authChanges`) and serializes `meemo-data-v2` operations so current-session 401s or login/logout transitions drop stale offline reads/writes; failed deletion persists an invalidation tombstone in `meemo-shell-v1`.
- **Client handling**: Login/logout await acknowledged worker cleanup (blocking login on failed cleanup, never blocking logout); client request generations suppress late 401s on XHR uploads/imports.
- **Rollback**: Publish a `sw.js` that deletes `meemo-*` caches and calls `self.registration.unregister()`.

## HTTP surface

Ordinary routes are registered by `src/http/router.js` from `src/http/app.js`; optional `/mcp`, `/oauth/*`, `/.well-known/*`, and `/api/mcp/*` are mounted by `src/http/mcp.js` (`/assistant/*` are SPA views):

- `/api/register`, `/api/login`, `/api/logout`, `/api/profile`: account creation (returning profile on login), session auth, and profile lookup.
- `/api/things`, `/api/things/:id/restore`, `/api/files`, `/api/tags`, `/api/settings`: authenticated API with revision CAS and reversible trash. Owner-only files send `Cache-Control: private, no-cache`; public/shared files send `public, max-age=0`.
- `/api/import`, `/api/export`: `.tar` archive transfer with size limits, rollback, and path-traversal checks.
- `/api/public/*`, `/api/rss/*`, `/public/*`, `/shared/*`, `/note/:thingId`: public feeds, RSS, shared views, and private note links.
- `/api/health/live`, `/api/health/ready`: liveness and readiness probes.

The OpenAPI 3.0 contract is maintained in [`docs/openapi.yaml`](openapi.yaml), with generated TypeScript types in `types/generated/api-types.ts` (`npm run api:generate`). When changing an endpoint, update its route handler, `docs/openapi.yaml`, generated types, `web/src/api/client.ts`, and backend tests.

## Performance and caching

- **MongoDB ESR & text indexes (`src/database/things.js`)**: Compound indexes `{ ownerId: 1, modifiedAt: -1 }`, `{ ownerId: 1, deletedAt: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }`, `{ ownerId: 1, deletedAt: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }`, sparse `{ 'attachments.identifier': 1 }`, and weighted text index `owner_text_content_tags` (`{ ownerId: 1, content: 'text', tags: 'text' }`). One-time `things-archived-backfilled` in `system_config` lets queries use `{ archived: false }` equality instead of `$exists` disjunctions; `connect-mongo` shares `DatabaseManager`'s pool with `touchAfter: 86400`.
- **Backend fast paths & streaming**: `thing-service.js` skips Markdown AST scans when content lacks URLs or `#`, skips re-enrichment on precomputed metadata updates, avoids read-after-write on `add()`, batches imports via `insertManyFull`, uses projected reads (`getAttachmentTarget`), and streams upload temp files for 12-byte magic-byte detection.
- **Reverse proxy offload**: [`nginx-reverse-proxy.conf`](nginx-reverse-proxy.conf) handles TLS and Gzip/Brotli compression; Express serves `/assets/` with `max-age=31536000, immutable` and HTML/`sw.js` with `no-cache`.
- **Frontend memoization**: `web/src/utils/markdown.ts` caches rendered HTML in a 500-entry LRU map (`<= 16,384` UTF-16 code units). `NoteCard.vue` caps list previews at 4,000 code units / 40 lines; `NotesView.vue` keeps cards mounted across column changes using `layoutMasonry` (`web/src/utils/masonry.ts`) and `ResizeObserver`; `NoteDetailModal` and `ImageLightbox` are lazy-loaded. Run `npm --prefix web exec -- vitest bench --run --root web` for ad-hoc list benchmarks.

## Architectural guardrails & change checklist

- **Complexity budget**: Keep Meemo a clean modular monolith. Do not introduce microservices, Redis, Kafka, Elasticsearch, vector databases, Pinia, or extra test runners without measured necessity.
- **Single source of truth**: Avoid dual-write projections or permanent internal compatibility shims. Persisted data/disk fallbacks (`ATTACHMENT_DIR/<username>/`, string attachment descriptors) remain only where existing user archives/files require them.
- **Thing-field change checklist**: When adding or altering a persisted Thing field, inspect `src/database/things.js`, `src/http/routes/things.js`, `docs/openapi.yaml` (`npm run api:generate`), `src/services/import-export-service.js`, `src/services/mcp-note-service.js` / `src/http/mcp-tools.js`, and `web/src/`.

## Build and deployment

`npm run build` compiles `web/` into `web/dist/` and copies into `public/`. `Dockerfile` runs a multi-stage Alpine build (`web-builder` + `builder`) and launches `start.sh` as user `1000:1000`. Production MongoDB is shared and independently operated; see [Deployment and releases](RELEASE_CHECKLIST.md) and [Backup and restore](BACKUP_RESTORE.md).
