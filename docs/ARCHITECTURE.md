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
9. `src/users.js` handles account operations and passwords through `MongoUserRepository`; legacy file/fallback repositories and the unused `UserRepository` compatibility alias have been removed.
10. `npm run build` compiles `web/` with Vite into ignored `web/dist/`, then copies the output to ignored `public/`, serving as the modern Vue 3 Single Page Application with client-side routing, Material Design 3 tokens, 12-color note theming, and a Google Keep-inspired expanded note viewing/editing modal dialog.

The runtime reads and writes only unified collections. `things` is the online single source of truth for tag identity and usage: `/api/tags` aggregates the owner-partitioned `things.tags` arrays in real time, while the persisted `tags` collection is a projection. Its repository exposes index/collection access and atomic replacement, not per-tag CRUD; projection test fixtures write documents directly. Ordinary Thing mutations (`add`, `put`, `del`) write directly and atomically to `things` without active-writer lease counters. Tag reconstruction (`cleanupTags`) repairs Thing tag arrays using compare-and-set filters, aggregates fresh usage from `things`, and atomically swaps the replacement collection over `tags` via MongoDB's atomic `renameCollection`. Dynamic `<user>_*` collection discovery is completely retired; it is not part of request handling.

Keep HTTP concerns in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`. HTTP routes must call services instead of database or filesystem APIs directly.

## Data and authentication

| Data | Storage |
| --- | --- |
| Notes, settings, sessions | MongoDB (unified collections: `things`, `settings`, `sessions`; `things.tags` is the single source of truth for tags; `tags` collection is a historical projection) |
| Attachments | `ATTACHMENT_DIR` partitioned by stable `userId` |
| Accounts | MongoDB `users` collection (accounts are stored solely in MongoDB; legacy user files are read-only inputs for offline migration tools only) |

Interactive login uses username/password authentication. Passwords are stored as bcrypt hashes, and successful login creates a server-side session backed by MongoDB with a stable user ID. Optional MCP clients use separately consented, resource-bound OAuth tokens; these cannot authenticate ordinary REST endpoints.

## Optional MCP assistant

`src/http/app.js` mounts `src/http/mcp.js` protocol routes before static/SPA/session handling and cookie-authenticated connection APIs after session middleware. Enabled mode uses the official MCP SDK's stateless Streamable HTTP and OAuth authorization-code/PKCE handlers; configuration is fixed at startup and defaults off. Reserved protocol/API paths return 404 when disabled rather than falling into SPA routing.

A mutually exclusive, absolute-UTC setup window (`MCP_BOOTSTRAP_UNTIL`, maximum 30 minutes) publishes only discovery and a rejection-only registration receiver. It skips the OAuth repository and all note tools. `src/storage/mcp-bootstrap.js` retains only bounded Google callback URLs in private temporary storage and removes them at expiry. Operator review is mandatory before any whitelist change; receipt alone proves neither Google caller identity nor user consent. Expired setup returns to disabled protocol behavior without interrupting ordinary REST.

`src/services/mcp-auth-service.js` manages grant/user/resource binding and expiry, while `src/database/mcp.js` owns five TTL-backed `mcp_*` collections (clients, requests, codes, grants, tokens). Client registration is shared metadata; user revocation affects only their grant. Opaque credential values are stored as hashes. These collections are sensitive, ephemeral authorization state, not a new note source of truth.

`src/http/mcp-tools.js` exposes `search_notes`, `get_note`, `batch_get_notes`, `list_tags`, `create_note`, `update_note`, `delete_note`, and `batch_delete_notes`; each request's token (grant, client and user state) is verified once by the SDK bearer middleware, and every tool call checks its required scope against that verified identity before delegating to `src/services/mcp-note-service.js`. Read tools accept `notes.read` or `notes.write`; writing requires `notes.write`. Updates and deletion require `expectedRevision`; creation starts at revision 1. Writes reuse `thing-service.js`, reject updates/deletion of public or shared notes, and move deleted notes to trash. Each MCP write atomically sets a Thing `assistant` marker (`action`, self-reported client name, time and, for updates, the `previous` values of only the changed fields); the owner's next REST write or restore clears it, so the browser can show the trace and undo an update through an ordinary revision-checked PUT. The marker is single-level, transient and not exported. Search optionally projects complete Markdown bodies with `include_content`; batch reads use one owner-scoped MongoDB `$in` query. Both batch tools accept 1–20 notes; batch deletion sequentially reuses single-note checks and returns successes and per-item errors without rollback. Reads return owner-scoped, bounded projections without attachment access, Markdown rendering or URL enrichment. Tag paging extends the existing aggregation compatibly; normal `/api/tags` behavior remains unchanged. Frontend `/assistant/authorize` and `/assistant/connections` reuse the account/session store and CSRF-protected consent/revocation APIs. Configuration, privacy, limits and operational details are documented in [Gemini assistant](GEMINI_ASSISTANT.md).

## Frontend state ownership

- The route query is the source of truth for search, tag, archive, and trash filters.
- Auth, notes, and settings use explicit composable stores. Creates, edits, and Undo place notes against the current view; text search membership is revalidated by the server.
- The detail dialog retains its last server snapshot and revision when a filtered edit leaves the visible list. Close preserves input typed during an in-flight save. Archive/delete first save the draft, lock editing during the pending mutation, and close only on success; Undo restores the saved content.
- Note duplication ("Make a copy") creates an independent unpinned, unarchived, private copy in Notes, preserving content, color, and attachment references. In the detail dialog, it duplicates the current draft without forcing a save or closing the original; duplicate requests are locked while in flight.
- Before upload, `web/src/utils/image.ts` downscales JPEG/PNG/WebP images in the browser to a 2048px long edge (JPEG stays JPEG, PNG/WebP become WebP); the original is not kept, and GIFs or images the browser cannot re-encode smaller upload unchanged.
- Image attachments render as top edge-to-edge banners on cards and in the detail dialog; embedded Markdown, HTML, and bracket filename references to image attachments are stripped from rendered body text to prevent duplicate display.
- Card More menus and account options use `ActionMenu.vue` with WAI-ARIA menu semantics, roving focus, Escape focus restoration, and outside dismiss. Menus and color pickers share viewport-clamped positioning (`usePopoverPosition.ts`) that tracks window scroll and resize.
- User/session changes reset scoped state, and request generations prevent stale responses from updating a later user's store.
- Unsaved composer and dialog text is mirrored to `localStorage` (`meemo_draft:*`, scoped by user ID) and restored after a reload or re-login; explicit logout clears it. The dialog also saves when the page becomes hidden. On `revision_conflict`, `useNotes.updateNote` re-reads the note and retries once with a field-level three-way merge; it reports the conflict when both sides changed the same field, or when the competing write came from an assistant (the latest note, with its trace, replaces the stale copy so the owner reviews it before saving again).
- Note cards expose a native keyboard-accessible detail button, manage focus and Escape handling within confirmation dialogs, and keep mutation controls below note content. The composer expands on focus; batch controls wrap on narrow screens with complete focus management. These surfaces reuse theme tokens and `UiIcon.vue`, documented in the [UI audit](reviews/2026-10-08-impeccable-ui-audit.md).

## Offline shell (service worker)

Decision: the production build registers `web/public/sw.js` and a web app manifest so the app is installable and starts from cached assets. Problem: daily phone use paid a full asset download on cold starts. Alternatives: a Vite PWA plugin (new dependency, precache manifest) or no offline support. Strategy: navigations are network-first with a 2.5 s timeout and fall back to the cached `index.html`; hashed `/assets/` are cache-first; same-origin `GET /api/*` reads are network-first with a cached fallback for offline viewing. Writes, auth, `/api/files`, export/import, health and MCP APIs remain network-only (never cached); the worker observes all same-origin API responses for session expiry. OAuth and `/assistant` bypass it. Operational impact: private note JSON may be cached on the device. The worker advances a generation and serializes private-cache storage operations on current-session 401s and at both ends of login/logout, rejecting stale writes, stale invalidations and cross-session offline fallbacks. Caching is suspended during overlapping auth transitions. Explicit page cleanup uses an acknowledged worker message (including the active worker of an uncontrolled page); only pages with no active worker delete private caches directly. Login/logout actions await cleanup in order; failed cleanup blocks login but does not prevent remote/local logout. Cache failures do not replace real network responses, and failed deletion leaves a non-sensitive tombstone in the existing shell cache, disabling private offline data across worker restarts until a successful clear. The corrected worker uses `meemo-data-v2` so in-flight pre-fix workers cannot populate its cache; the previous data cache is retired on activation, so offline notes need one online refresh after upgrading. If the browser refuses both tombstone persistence and data deletion, cleanup reports failure but cannot guarantee erasure; browser site-data reset is required. Client request generations suppress late old-session 401 notifications, including XHR uploads/imports. Old hashed assets stay in the shell cache until `VERSION` in `sw.js` changes. Rollback: publish a `sw.js` that deletes `meemo-*` caches and calls `self.registration.unregister()`; deleting the file alone leaves installed workers in place (they still fetch fresh HTML online).

## HTTP surface

Ordinary routes are registered by `src/http/router.js` from `src/http/app.js`:

- Optional `/mcp`, `/oauth/*`, OAuth `/.well-known/*`, and `/api/mcp/*` are separately mounted by `src/http/mcp.js`; `/assistant/*` are SPA views.

- `/api/register`, `/api/login`, `/api/logout`: local authentication and session management; a successful login returns the user profile so the client skips a follow-up `/api/profile` request
- `/api/profile`: authenticated user profile; settings use `/api/settings`
- `/api/things`, `/api/things/:id/restore`, `/api/files`, `/api/tags`, `/api/settings`: authenticated application API; Thing revisions use CAS and deletes move notes to reversible trash. Owner-only attachments are served `private, no-cache` (never stored by shared proxies; the browser revalidates with the session, usually a 304), so logout and revocation take effect; files of public or shared notes keep `public, max-age=0` so unsharing takes effect
- `/api/import`, `/api/export`: archive transfer with size limits and path traversal protection
- `/api/public/*`, `/api/rss/*`, `/public/*`, `/shared/*`: public streams, RSS feeds with canonical note URLs, and shared notes; `/note/:thingId` is an authenticated stable private link
- `/api/health/live`, `/api/health/ready`, `/api/healthcheck`: container and orchestration health probes

The authoritative OpenAPI 3.0 specification is maintained in `docs/openapi.yaml`, and progressive TypeScript declarations for core domain models and API contracts reside in `types/api.d.ts`.

When changing an endpoint, update its route handler, the OpenAPI specification, and the corresponding browser client call under `web/src/api/client.ts`. Add or update a test under `src/test/` for non-trivial server behavior.

## Maintenance and tooling

Meemo maintains operations, garbage collection, and verification tooling in `scripts/`:

- `scripts/migrate-thing-revisions.js`: Backfills missing Thing revisions, refuses invalid values, and requires an exact target database name.
- `scripts/gc-attachments.js`: Identifies and removes unreferenced orphan attachments from filesystem storage.
- `scripts/verify.js`: Comprehensive quality and integration verification orchestrator.

The one-off v1-to-v2 legacy collection and file-user migration tooling (`migrate-data-to-v2.js`, `migrate-users-to-mongo.js`, `preflight-legacy-retirement.js`, `verify-production-readiness.js`, `owner-map.js`) has been retired following full production cutover to unified collections.

## Performance and caching architecture

Meemo employs a multi-tiered performance strategy balancing database efficiency, server event-loop capacity, and browser rendering:

1. **MongoDB Compound ESR and Full-Text Indexing**:
   Queries in `src/database/things.js` follow MongoDB's Equality-Sort-Range (ESR) guideline to eliminate in-memory sort stages:
   - Default note list feed: `{ ownerId: 1, deletedAt: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }` covers the active/trash state, owner/archive filters, and stable compound sorting.
   - Tag-filtered feed: `{ ownerId: 1, deletedAt: 1, tags: 1, archived: 1, sticky: -1, modifiedAt: -1, _id: -1 }` enables owner/deletion/tag lookups with stable sorting.
   - Full-text search: `{ ownerId: 1, content: 'text', tags: 'text' }` (`owner_text_content_tags`, weighted `{ tags: 10, content: 5 }`) provides owner-isolated text searches with English Porter stemming and TF-IDF relevance scoring.
   - Secondary indexes (e.g. `publicId` and `modifiedAt`) are initialized concurrently using `Promise.all` at startup.

2. **Backend Fast-Path Parsing**:
   Note parsing in `src/services/thing-service.js` avoids unnecessary Markdown-it abstract syntax tree parsing when notes lack candidate URL schemes (`URL_FEATURE_PATTERN`) or hashtags (leading `#` boundary check). Plaintext notes without URLs or tags bypass heavy regex passes and link extractions. Writes extract URLs once and reuse them for tag parsing and SSRF-protected enrichment. Creation renders the document returned by the repository without reading it back again.

3. **Reverse Proxy Offload (Nginx)**:
   In production, HTTP compression (Gzip/Brotli) and static asset caching are offloaded to an upstream Nginx reverse proxy ([`docs/nginx-reverse-proxy.conf`](nginx-reverse-proxy.conf)). The Node.js application serves uncompressed HTTP responses, saving CPU and event-loop time under high concurrency. Static frontend assets under `/assets/` generated by Vite include content hashes and are served with immutable, long-lived client caching headers (`max-age=31536000, immutable`).

4. **Frontend Render Memoization**:
   The Vue 3 frontend (`web/src/utils/markdown.ts`) caches sanitized HTML in a bounded true LRU `Map` keyed by note content (repositioning entries to most-recently-used on cache hit). It holds at most 500 entries and only caches content of at most 16,384 JavaScript string code units (not a byte limit). In `web/src/views/NotesView.vue`, height-balanced masonry column distribution is memoized via reactive `computed()` properties (`pinnedColumns` and `otherColumns`), eliminating O(N) array recalculations on unrelated render cycles. Components reuse the cached HTML during note list filtering and tab switches. Note cards memoize Markdown separately from search highlighting, including notes above the shared cache limit. Task-list token processing uses one forward pass rather than repeated backward scans. Route components are lazy-loaded using Vue Router dynamic imports.

   Run `npm --prefix web exec -- vitest bench --run --root web` from the repository root for uncached 500/2,000-item list rendering benchmarks (including sanitization). Timings are environment-dependent, not CI pass/fail thresholds.

## Verification layers

- Backend behavior and contracts: Mocha via `npm test`.
- Frontend state and request behavior: Vitest via `npm --prefix web test`.
- Type and production asset checks: `npm --prefix web run typecheck` and `npm run build`.
- Runtime integration: isolated Docker Compose smoke tests covering health, authentication, and representative writes/reads.

## Note list rendering

Saving updates local note state and recalculates the height-balanced masonry columns via memoized `computed()` properties (shortest column first, from bounded estimates of the displayed body). Cards can be remounted when they move between columns. To bound Markdown parsing, sanitization, and DOM work, `NoteCard.vue` limits its body preview to 4,000 UTF-16 code units or 40 lines when an `openDetail` listener is present. It displays an “Open note to read more” hint for truncated previews. Full source remains in state; task toggles operate on that source, not the preview. Detail dialogs and standalone private/shared note pages retain complete content. Search matching remains server-side; list highlighting applies to the visible preview.

## Build and deployment

`npm run build` compiles the modern Vue 3 + Vite + TypeScript application in `web/` into staging output `web/dist/`, then copies it to the Express-served `public/`.
`npm run build:web` updates only `web/dist/`. Do not commit generated output.

The Dockerfile uses a multi-stage build (`web-builder` for `web/` and `builder` for native production dependencies), running the application as an unprivileged user while serving Vue 3 assets from `public/`. `start.sh` creates the attachment directory and starts Node inside the container. Repository `docker-compose.yml` builds `meemo:local` and supplies MongoDB and persistent named volumes.

Production MongoDB is independently deployed and shared with travel-cards. `deploy.sh` builds `meemo:latest` once with the commit label, then updates only `meemo` through the existing `/home/lin/meemo` configuration using `--no-deps --no-build --wait`. It checks health and image identity, and restores the previous local image if activation fails. Routine deployment does not operate on MongoDB or perform data backup/recovery. Container recreation causes a short interruption; see [Deployment and releases](RELEASE_CHECKLIST.md).

CI validates pull requests and pushes to `master` without publishing images. The manually dispatched **RC release** workflow reruns validation from the current `master` head, publishes an immutable multi-platform RC image (`linux/amd64` and `linux/arm64`) to GHCR with OCI metadata, SBOM, and provenance, then creates a GitHub prerelease. It does not update stable image aliases or deploy production. See the [documentation index](README.md), [backup/restore runbook](BACKUP_RESTORE.md), [dependency security audit](DEPENDENCY_SECURITY.md), and [release checklist](RELEASE_CHECKLIST.md).
