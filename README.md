# Meemo

Meemo is a self-hosted manager for notes, ideas, links, bookmarks, and tasks. It uses username/password authentication, MongoDB for application data, accounts, and sessions, and the local filesystem for attachments.

## Features

- Google Keep-inspired expanded note viewing and editing modal dialog with responsive backdrop, real-time 12-color theming, and auto-save
- Markdown notes with tags, wikilinks, task lists, and MongoDB `$text` full-text search with relevance scoring
- Attachments, archive, sticky notes, public sharing, stable private note links, and a reversible trash
- Public feeds and RSS with canonical note URLs
- JSON archive import and export
- High-performance MongoDB compound ESR indexes, text indexing, and tag aggregation
- Local username/password accounts with bcrypt password hashes stored exclusively in MongoDB
- MongoDB unified collection model with stable user identity decoupling
- Read-only retirement preflight and historical v1-to-v2 migration tooling
- Docker Compose deployment with health checks and graceful shutdown
- Production-ready reverse proxy template offloading compression and caching to Nginx

## Quick start

Requirements: Docker with Docker Compose.

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Open <http://localhost:3000>, register an account, and sign in. View logs with `docker compose logs -f` and stop the stack with `docker compose down`.

> Registration is configurable via `REGISTRATION_MODE` (`open`, `first-user`, or `disabled`). Put Meemo behind an access-controlled network or reverse proxy if account creation must be restricted.

## Authentication and storage

Meemo supports username/password authentication with accounts stored exclusively in MongoDB (`AUTH_USER_SOURCE=mongo`). Legacy file and fallback repositories have been retired. Successful logins create server-side sessions stored in MongoDB with decoupled, stable user IDs.

The Compose stack uses two named volumes:

- `meemo_data`: attachment files stored on disk
- `mongodb_data`: accounts, notes, tags, settings, sessions, and optional MCP authorization state

Set a stable, strong `SESSION_SECRET`. Development without it generates a process-local secret, invalidating existing sessions after restart. Production startup fails when the secret is missing.

Running `docker compose down -v` permanently deletes both volumes and all Meemo data.

## Configuration

| Variable | Application default | Compose value | Purpose |
| --- | --- | --- | --- |
| `PORT` | `3000` | `3000` | Container HTTP port |
| `BIND_ADDRESS` | `0.0.0.0` | `0.0.0.0` | HTTP listen address |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/meemo` | `mongodb://mongodb:27017/meemo` | MongoDB connection URL |
| `APP_ORIGIN` | `http://localhost` | `http://localhost:3000` | Public origin used in RSS links |
| `ATTACHMENT_DIR` | `./storage` | `/app/data/storage` | Attachment directory |
| `AUTH_USER_SOURCE` | `mongo` | `mongo` | Account repository: `mongo` (exclusive target) |
| `SESSION_SECRET` | Random in development; required in production | Value of host `SESSION_SECRET` | Session signing secret |
| `REGISTRATION_MODE` | `open` in development; `first-user` in production | `first-user` | Registration policy: `open`, `first-user`, or `disabled` |
| `URL_ENRICHMENT_ENABLED` | `false` | `false` | Outbound URL metadata fetch (disabled by default for SSRF safety) |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10MB) | `10485760` | Maximum attachment upload size in bytes |
| `MAX_IMPORT_SIZE` | `52428800` (50MB) | `52428800` | Maximum import archive size in bytes |
| `ENABLE_WORKERS` | `true` | `true` | Enable background cleanup workers |
| `SHUTDOWN_TIMEOUT_MS` | `15000` | `15000` | Graceful shutdown timeout in milliseconds |
| `MONGO_MAX_POOL_SIZE` | `50` | `50` | Maximum MongoDB connection pool size |
| `MONGO_MIN_POOL_SIZE` | `1` | `1` | Minimum MongoDB connection pool size |
| `MEEMO_PORT` | — | `3000` | Host port mapped to container port 3000 |
| `MCP_ENABLED` | `false` | Not forwarded | Only the exact value `true` enables read-only MCP |
| `MCP_PUBLIC_URL` | Unset | Not forwarded | Required fixed HTTPS bare origin in full or setup mode; HTTP loopback allowed in development |
| `MCP_REDIRECT_URIS` | Unset | Not forwarded | Required exact approved HTTPS callback URLs, comma-separated without spaces |
| `MCP_ALLOWED_ORIGINS` | Public origin only | Not forwarded | Additional approved HTTPS browser origins, comma-separated without spaces |
| `MCP_BOOTSTRAP_UNTIL` | Unset | Not forwarded | Setup-only UTC deadline within 30 minutes; requires `MCP_ENABLED=false`, denies all registration/access and expires automatically |

`.env.example` documents non-secret configuration keys. Node does not automatically load `.env`; export variables or pass them explicitly to the container. In particular, the repository Compose file does not forward MCP keys: adding them to a host `.env` alone does not enable the feature. See [MCP configuration](docs/GEMINI_ASSISTANT.md#enable-deliberately).

For a public hostname or reverse proxy:

```sh
export APP_ORIGIN="https://meemo.example.com"
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

A production-ready reverse proxy template offloading gzip/brotli compression, SSL termination, and static asset caching to Nginx is provided at [`docs/nginx-reverse-proxy.conf`](docs/nginx-reverse-proxy.conf).

## Gemini assistant (optional, read-only)

Meemo exposes default-disabled MCP + OAuth for Gemini custom apps. Supported tools are `search_notes`, `get_note` and `list_tags`; no Gemini API key or note-writing tools are included. Users explicitly approve account-level private-note read access, valid up to 24 hours, and can revoke their own connections in **Settings → Manage assistant connections**. Retrieved content may be sent to Google.

See [configuration, protocol limits, privacy and recovery](docs/GEMINI_ASSISTANT.md) before setting `MCP_ENABLED=true`, a fixed HTTPS `MCP_PUBLIC_URL`, and exact reviewed `MCP_REDIRECT_URIS` in the Node/container environment. If callbacks are not yet known, use the [short-lived callback discovery procedure](docs/GEMINI_ASSISTANT.md#discover-the-actual-gemini-callbacks-safely), not placeholder allowlists. Real Meemo Gemini web/mobile acceptance is pending; local tests are not client acceptance. Enabling or deploying requires separate authorization.

## Development

Requirements: Node.js 24 or newer, npm, and Docker.

```sh
npm ci
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web test
npm run build
npm test
npm run verify              # unified quality + isolated Compose smoke checks
npm run verify:restore      # explicit synthetic backup/restore exercise (Docker)
npm run verify:search:relevance # isolated synthetic search labels (Docker)
./localdevelopment
```

`npm run build` compiles Vue 3 source into ignored `web/dist/` (disposable staging), then copies it to ignored `public/` (the Express runtime copy). `npm run build:web` only produces `web/dist/`; it does not update the Express-served frontend. Frontend behavior tests use Vitest; backend and contract tests use Mocha through `npm test`, which starts and removes a temporary MongoDB container and its anonymous data volumes. `./localdevelopment` starts a reusable development MongoDB container and the application.

Recovery and search-quality checks are explicit entry points, separate from `npm run verify`. Both create their own temporary Docker resources and reject external database/volume arguments. See the [restore verification](docs/BACKUP_RESTORE.md#repeatable-synthetic-restore-verification) and [search sample](docs/SEARCH_BASELINE.md#synthetic-relevance-sample-m3-01) for scope and result semantics; a documented search miss is not a complete relevance pass.

`./deploy.sh` is a host-specific production command, not a development step: it builds `meemo:latest` from this repository and runs Compose in `/home/lin/meemo`. That production Compose configuration must select `meemo:latest`; the repository's Compose file instead builds `meemo:local`. This recreates containers as needed, not a zero-downtime hot restart. Follow the [release checklist](docs/RELEASE_CHECKLIST.md) for production authorization, backup, image verification, and rollback.

Before enabling revision-protected writes on an existing database, stop all Thing writers and run `npm run migrate:thing-revisions -- --dry-run --mongo-url <url> --expect-database <name>`, then apply and verify with the same explicit database name. The migration only fills missing revisions with `1` and refuses invalid existing values.

To run only the Node.js process, provide MongoDB separately and use `npm start`.

Runtime tag lists are derived from each owner's `things.tags` arrays in real time, so add, edit/archive, delete, and import operate lock-free without cross-collection lease counters. The persisted `tags` collection is an offline maintenance projection. `thingService.cleanupTags` repairs Thing tag arrays using compare-and-set updates, aggregates fresh tag usage from `things`, and atomically swaps the projection over `tags` via MongoDB's atomic `renameCollection`. For offline maintenance and pre-cutover readiness verification (`verify-production-readiness.js`), a durable MongoDB write freeze gate (`things.acquireWriteFreeze` / `things.requireWriteFreeze`) blocks Thing mutations and fails closed when unverified.

## Repository and production directories

Keep source code and production state in separate directories:

- Use the Git checkout for source, tests, project documentation, and image builds.
- Use a separate production operations directory for the active Compose configuration and persistent state. `deploy.sh` currently targets `/home/lin/meemo`; it is not a portable deployment entry point.
- Runtime accounts live in MongoDB. Retained legacy account files are migration/rollback evidence, not an active authentication source.

Build and test from the repository. Operate the deployed containers from the production directory. Keep backups and migration evidence outside both directories, and never copy credentials, account data, attachments, database files, or recovery artifacts into the repository.

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Runtime composition root and server entry point (`startServer`) |
| `src/lifecycle.js` | Worker management, MongoDB pool lifecycle, and graceful shutdown sequencing |
| `src/http/` | Injected Express app factory, session/upload setup, domain routes, validation, and uniform HTTP errors |
| `src/services/` | Promise-first authentication, things, attachments, sharing, settings, health, and import/export behavior |
| `src/storage/` | Local filesystem attachment adapter |
| `src/database/` | MongoDB persistence for things, tags, settings, and users; sessions use `connect-mongo` in `src/http/session.js` |
| `src/users.js` | Account repository abstraction targeting MongoDB users and bcrypt password handling |
| `types/` | TypeScript domain definitions (`types/api.d.ts`) and OpenAPI generated types (`types/generated/api-types.ts`) |
| `scripts/` | Build/verification entry points, offline migrations, read-only readiness verifiers, benchmark, and attachment GC |
| `src/test/` | Backend and contract tests run by Mocha |
| `web/` | Vue 3 + Vite + TypeScript application and Vitest behavior tests; route query owns note filters |
| `docs/` | [Documentation index](docs/README.md), current contracts/runbooks, roadmaps, and review snapshots |
| `public/`, `web/dist/` | Generated frontend output; rebuild rather than edit |
| `runTests`, `localdevelopment` | Root development/test entry points |
| `Dockerfile`, `start.sh`, `docker-compose.yml`, `deploy.sh` | Container startup and deployment entry points |
| `.github/` | Continuous integration and repository configuration |

Do not commit generated `public/`, `web/dist/`, `node_modules/`, `web/node_modules/`, account files, attachments, or database data.

## Contributing and security

- [Documentation index](docs/README.md)
- [Contribution guide](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Long-term architecture](docs/LONG_TERM_ARCHITECTURE.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Master branch protection](docs/BRANCH_PROTECTION.md)
- [Dependency security](docs/DEPENDENCY_SECURITY.md)
- [Security policy](SECURITY.md)

## License

Meemo is available under the [MIT License](LICENSE).
