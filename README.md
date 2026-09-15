# Meemo

Meemo is a self-hosted manager for notes, ideas, links, bookmarks, and tasks. It uses username/password authentication, MongoDB for application data and sessions, and the local filesystem for attachments. Accounts can use MongoDB or the legacy file repository selected by configuration.

## Features

- Markdown notes with tags and full-text search
- Attachments, archive, sticky notes, and public sharing
- Public feeds and RSS
- JSON archive import and export
- Local username/password accounts with bcrypt password hashes
- MongoDB unified collection model with stable user identity decoupling
- Read-only retirement preflight and historical v1-to-v2 migration tooling
- Docker Compose deployment

## Quick start

Requirements: Docker with Docker Compose.

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Open <http://localhost:3000>, register an account, and sign in. View logs with `docker compose logs -f` and stop the stack with `docker compose down`.

> Registration is configurable via `REGISTRATION_MODE` (`open`, `first-user`, or `disabled`). Put Meemo behind an access-controlled network or reverse proxy if account creation must be restricted.

## Authentication and storage

Meemo supports username/password authentication. `AUTH_USER_SOURCE` selects MongoDB, the legacy JSON file configured by `USERS_FILE`, or the temporary fallback repository. MongoDB is the production target; keep the file source only while migration or rollback compatibility is explicitly required. Successful logins create server-side sessions stored in MongoDB with decoupled, stable user IDs.

The Compose stack uses two named volumes:

- `meemo_data`: attachments and, while the legacy file account source is selected, the account file
- `mongodb_data`: notes, tags, settings, and sessions

Set a stable, strong `SESSION_SECRET`. When it is omitted, Meemo generates a process-local secret and existing sessions become invalid after every restart.

Running `docker compose down -v` permanently deletes both volumes and all Meemo data.

## Configuration

| Variable | Application default | Compose value | Purpose |
| --- | --- | --- | --- |
| `PORT` | `3000` | `3000` | Container HTTP port |
| `BIND_ADDRESS` | `0.0.0.0` | `0.0.0.0` | HTTP listen address |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/meemo` | `mongodb://mongodb:27017/meemo` | MongoDB connection URL |
| `APP_ORIGIN` | `http://localhost` | `http://localhost:3000` | Public origin used in RSS links |
| `ATTACHMENT_DIR` | `./storage` | `/app/data/storage` | Attachment directory |
| `USERS_FILE` | `./.users.json` | — | Account data file (deprecated legacy file source; offline tests/migration only) |
| `AUTH_USER_SOURCE` | `file` | `mongo` | Account repository: `mongo` (required in production), or deprecated `file`/`fallback` for offline tests |
| `SESSION_SECRET` | Random on startup | Value of host `SESSION_SECRET` | Session signing secret |
| `REGISTRATION_MODE` | `open` | `first-user` | Registration policy: `open`, `first-user`, or `disabled` |
| `URL_ENRICHMENT_ENABLED` | `false` | `false` | Outbound URL metadata fetch (disabled by default for SSRF safety) |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10MB) | `10485760` | Maximum attachment upload size in bytes |
| `MAX_IMPORT_SIZE` | `52428800` (50MB) | `52428800` | Maximum import archive size in bytes |
| `ENABLE_WORKERS` | `true` | `true` | Enable background cleanup workers |
| `SHUTDOWN_TIMEOUT_MS` | `15000` | `15000` | Graceful shutdown timeout in milliseconds |
| `MONGO_MAX_POOL_SIZE` | `50` | `50` | Maximum MongoDB connection pool size |
| `MONGO_MIN_POOL_SIZE` | `1` | `1` | Minimum MongoDB connection pool size |
| `MEEMO_PORT` | — | `3000` | Host port mapped to container port 3000 |

For a public hostname or reverse proxy:

```sh
export APP_ORIGIN="https://meemo.example.com"
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

## Development

Requirements: Node.js 20 or newer, npm, and Docker.

```sh
npm ci
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web test
npm run build
npm test
./localdevelopment
```

`npm run build` compiles modern Vue 3 web source in `web/` into the ignored `public/` directory. Frontend behavior tests use Vitest; backend and contract tests use Mocha through `npm test`, which starts and removes a temporary MongoDB container. `./localdevelopment` starts a reusable development MongoDB container and the application.

To run only the Node.js process, provide MongoDB separately and use `npm start`.

Runtime tag lists are derived from each owner's `things.tags` arrays in real time, so add, edit/archive, delete, and import operate lock-free without cross-collection lease counters. The persisted `tags` collection is an offline maintenance projection. `thingService.cleanupTags` repairs Thing tag arrays using compare-and-set updates, aggregates fresh tag usage from `things`, and atomically swaps the projection over `tags` via MongoDB's atomic `renameCollection`. For offline maintenance and pre-cutover readiness verification (`verify-production-readiness.js`), a durable MongoDB write freeze gate (`things.acquireWriteFreeze` / `things.requireWriteFreeze`) blocks Thing mutations and fails closed when unverified.

## Repository and production directories

Keep source code and production state in separate directories. On the current host:

- `/home/lin/meemo-repo` is the only Meemo Git repository and the only place where source, tests, and project documentation are edited.
- `/home/lin/meemo` is the production operations directory. It contains only the active Compose configuration, local account source, attachment storage, and a short operator README; it is not a source checkout or image build context.

Build and test from the repository. Operate the deployed containers from the production directory. Keep backups and migration evidence outside both directories, and never copy credentials, account data, attachments, database files, or recovery artifacts into the repository.

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Runtime composition root and server entry point (`startServer`) |
| `src/lifecycle.js` | Worker management, MongoDB pool lifecycle, and graceful shutdown sequencing |
| `src/http/` | Injected Express app factory, session/upload setup, domain routes, validation, and uniform HTTP errors |
| `src/services/` | Promise-first authentication, things, attachments, sharing, settings, health, and import/export behavior |
| `src/storage/` | Local filesystem attachment adapter |
| `src/database/` | MongoDB persistence (things, tags, settings, users, and sessions) |
| `src/users.js` | Account repository abstraction and password handling |
| `types/` | TypeScript domain definitions (`types/api.d.ts`) and OpenAPI generated types (`types/generated/api-types.ts`) |
| `scripts/` | Historical v1-to-v2 migration tools, read-only retirement/business-readiness verifiers, benchmark, and attachment GC |
| `src/test/` | Backend and contract tests run by Mocha |
| `web/` | Vue 3 + Vite + TypeScript application and Vitest behavior tests; route query owns note filters |
| `docs/` | Architecture, security, backup/restore, release, and refactoring documentation |
| `Dockerfile`, `docker-compose.yml` | Container build and deployment |
| `.github/` | Continuous integration and repository configuration |

Do not commit generated `public/`, `node_modules/`, account files, attachments, or database data.

## Contributing and security

- [Contribution guide](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Backup and restore](docs/BACKUP_RESTORE.md)
- [Release checklist](docs/RELEASE_CHECKLIST.md)
- [Master branch protection](docs/BRANCH_PROTECTION.md)
- [Dependency security](docs/DEPENDENCY_SECURITY.md)
- [Security policy](SECURITY.md)

## License

Meemo is available under the [MIT License](LICENSE).
