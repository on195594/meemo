# Architecture

Meemo is a small browser application served by Express and backed by MongoDB and a filesystem attachment store.

## Runtime flow

1. `app.js` provides the `createApp` Express application factory and `startServer` runtime entry point, managed by `src/lifecycle.js` (`WorkerManager`, `DatabaseManager`, `ShutdownManager`).
2. `src/http/router.js` composes domain route modules under `src/http/routes/`; Zod schemas validate body, query, and path input before handlers run.
3. `src/http/responses.js` maps failures to stable API error codes without returning internal stack traces or filesystem paths.
4. `src/services/` implements authentication, notes, attachments, sharing, settings, health, and import/export behavior without depending on Express.
5. Runtime, HTTP, services, storage, user repositories, and primary database modules use Promise-first `async`/`await`; callback adapters remain only for legacy scripts and tests during migration.
6. `src/database/` reads and writes MongoDB collections (unified collections `things`, `tags`, and `settings` partitioned by `ownerId`, plus `users` and `sessions`).
7. `src/storage/local-storage.js` owns persistent attachment filesystem access.
8. `src/users.js` abstracts account storage across file and MongoDB implementations via `UserRepository`.
9. `frontend/` is compiled by Gulp into the generated, ignored `public/` directory.

Keep HTTP concerns in `src/http/`, application behavior in `src/services/`, persistence in `src/database/`, and attachment filesystem access in `src/storage/`. HTTP routes must call services instead of database or filesystem APIs directly.

## Data and authentication

| Data | Storage |
| --- | --- |
| Notes, tags, settings, sessions | MongoDB (unified collections: `things`, `tags`, `settings`, `sessions`) |
| Attachments | `ATTACHMENT_DIR` partitioned by stable `userId` |
| Accounts | MongoDB `users` collection (with fallback to `USERS_FILE` via `FallbackUserRepository`) |

Meemo supports username/password authentication only. Passwords are stored as bcrypt hashes, and successful login creates a server-side session backed by MongoDB with a stable user ID.

## HTTP surface

Routes are registered in `app.js`:

- `/api/register`, `/api/login`, `/api/logout`: local authentication and session management
- `/api/profile`: authenticated user identity and settings
- `/api/things`, `/api/files`, `/api/tags`, `/api/settings`: authenticated application API
- `/api/import`, `/api/export`: archive transfer with size limits and path traversal protection
- `/api/public/*`, `/api/rss/*`, `/public/*`: public streams and feeds
- `/api/health/live`, `/api/health/ready`, `/api/healthcheck`: container and orchestration health probes

When changing an endpoint, update its route handler and the corresponding browser call under `frontend/js/`. Add or update a test under `src/test/` for non-trivial server behavior.

## Migration and tooling

Meemo provides zero-downtime shadow migration scripts:

- `scripts/migrate-users-to-mongo.js`: Migrates legacy file-based accounts to MongoDB `users` with `--dry-run`, `--apply`, and `--verify`.
- `scripts/migrate-data-to-v2.js`: Migrates dynamic legacy `<user>_*` collections into unified `things`, `tags`, and `settings` collections partitioned by `ownerId` with `--dry-run`, `--apply`, and `--verify`.

## Build and deployment

`npm run build` compiles `frontend/` into `public/`. Do not commit generated output.

The Dockerfile uses a builder stage for frontend assets and dependencies, then runs the application as an unprivileged user. `docker-compose.yml` supplies MongoDB and persistent named volumes.
