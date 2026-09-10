# Meemo

Meemo is a self-hosted manager for notes, ideas, links, bookmarks, and tasks. It uses username/password authentication, MongoDB for application data and sessions, and the local filesystem for accounts and attachments.

## Features

- Markdown notes with tags and full-text search
- Attachments, archive, sticky notes, and public sharing
- Public feeds and RSS
- JSON archive import and export
- Local username/password accounts with bcrypt password hashes
- MongoDB unified collection model with stable user identity decoupling
- Zero-downtime shadow data migration tooling
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

Meemo supports username/password authentication. Accounts can be stored natively in MongoDB or in the legacy JSON file configured by `USERS_FILE`. Successful logins create server-side sessions stored in MongoDB with decoupled, stable user IDs.

The Compose stack uses two named volumes:

- `meemo_data`: accounts and attachments
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
| `USERS_FILE` | `./.users.json` | `/app/data/.users.json` | Account data file |
| `AUTH_USER_SOURCE` | `file` | `file` | Primary account source: `file` or `mongo` |
| `SESSION_SECRET` | Random on startup | Value of host `SESSION_SECRET` | Session signing secret |
| `REGISTRATION_MODE` | `open` | `open` | Registration policy: `open`, `first-user`, or `disabled` |
| `URL_ENRICHMENT_ENABLED` | `false` | `false` | Outbound URL metadata fetch (disabled by default for SSRF safety) |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10MB) | `10485760` | Maximum attachment upload size in bytes |
| `MAX_IMPORT_SIZE` | `52428800` (50MB) | `52428800` | Maximum import archive size in bytes |
| `ENABLE_WORKERS` | `true` | `true` | Enable background cleanup workers |
| `TAG_CLEANUP_INTERVAL_MS` | `60000` | `60000` | Tag cleanup worker interval in milliseconds |
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

Requirements: Node.js 18 or newer, npm, and Docker.

```sh
npm ci
npm run build
npm test
./localdevelopment
```

`npm run build` compiles modern Vue 3 web source in `web/` into the ignored `public/` directory. `npm test` starts and removes a temporary MongoDB container. `./localdevelopment` starts a reusable development MongoDB container and the application.

To run only the Node.js process, provide MongoDB separately and use `npm start`.

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Express entry point, app factory (`createApp`), and server lifecycle (`startServer`) |
| `src/lifecycle.js` | Worker management, MongoDB pool lifecycle, and graceful shutdown sequencing |
| `src/http/` | Domain route modules, authentication middleware, Zod validation, and uniform HTTP errors |
| `src/services/` | Promise-first authentication, things, attachments, sharing, settings, health, and import/export behavior |
| `src/storage/` | Local filesystem attachment adapter |
| `src/database/` | MongoDB persistence (things, tags, settings, users) |
| `src/users.js` | Account repository abstraction and password handling |
| `scripts/` | Idempotent zero-downtime migration scripts (`dry-run`, `apply`, `verify`) |
| `src/test/` | Mocha tests |
| `web/` | Modern Vue 3 + Vite + TypeScript browser application compiled into `public/` |
| `docs/` | Architecture, security, and refactoring documentation |
| `Dockerfile`, `docker-compose.yml` | Container build and deployment |
| `.github/` | Continuous integration and repository configuration |

Do not commit generated `public/`, `node_modules/`, account files, attachments, or database data.

## Contributing and security

- [Contribution guide](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security policy](SECURITY.md)

## License

Meemo is available under the [MIT License](LICENSE).
