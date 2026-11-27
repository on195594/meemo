# Meemo

Meemo is a self-hosted manager for notes, ideas, links, bookmarks, and tasks backed by Express, Vue 3, MongoDB, and filesystem attachment storage.

## Features

- Google Keep-inspired card stream and expanded note editor with 12-color theming, checklists, hashtags, wikilinks, and auto-save
- Fast 4,000-char / 40-line list previews with MongoDB `$text` search and relevance scoring
- Attachments, archive, pinned notes, note duplication ("Make a copy"), public sharing/RSS, private links, and reversible Trash
- Portable `.tar` import/export containing JSON notes and attachment files
- Local username/password accounts (bcrypt + MongoDB sessions) and optional, default-disabled MCP + OAuth assistant access
- Installable PWA offline shell with session-fenced cache invalidation and Docker Compose deployment

## Quick start

Requirements: Docker with Docker Compose.

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Open <http://localhost:3000>, register an account, and sign in. Use `docker compose logs -f` for logs and `docker compose down` to stop (`docker compose down -v` deletes both `meemo_data` and `mongodb_data` volumes).

For public hosting or reverse proxy setup, set `APP_ORIGIN="https://meemo.example.com"` and adapt [`docs/nginx-reverse-proxy.conf`](docs/nginx-reverse-proxy.conf) for TLS and gzip/brotli compression.

## Configuration

| Variable | Application default | Compose value | Purpose |
| --- | --- | --- | --- |
| `PORT` | `3000` (or `VITE_DEV_PORT`) | `3000` | Container HTTP port |
| `BIND_ADDRESS` | `0.0.0.0` | `0.0.0.0` | HTTP listen address |
| `MONGODB_URL` | `mongodb://127.0.0.1:27017/meemo` | `mongodb://mongodb:27017/meemo` | MongoDB connection URL |
| `APP_ORIGIN` | `http://localhost` (RSS); unset otherwise | `http://localhost:3000` | Public origin for RSS/wikilinks and HTTPS production `Secure` cookies |
| `ATTACHMENT_DIR` | `./storage` | `/app/data/storage` | Filesystem attachment directory |
| `AUTH_USER_SOURCE` | `mongo` | `mongo` | Exclusive account store (`mongo`) |
| `SESSION_SECRET` | Random in dev; required in prod | Host `SESSION_SECRET` | Session signing secret |
| `REGISTRATION_MODE` | `open` in dev; `first-user` in prod | `first-user` | Account registration: `open`, `first-user`, or `disabled` |
| `TRUST_PROXY` | `loopback, uniquelocal` | App default | Express `trust proxy` setting |
| `CORS_ORIGIN` | Unset | Unset | Optional comma-separated credentialed CORS origins |
| `URL_ENRICHMENT_ENABLED` | `false` | App default | Outbound URL metadata probe (disabled for SSRF safety) |
| `MAX_ATTACHMENT_SIZE` | `10485760` (10MB) | App default | Max attachment upload bytes |
| `MAX_IMPORT_SIZE` | `52428800` (50MB) | App default | Max import `.tar` archive bytes |
| `SHUTDOWN_TIMEOUT_MS` | `15000` | App default | Graceful HTTP shutdown timeout (ms) |
| `MONGO_MAX_POOL_SIZE` | `50` | App default | MongoDB max connection pool size |
| `MONGO_MIN_POOL_SIZE` | `1` | App default | MongoDB min connection pool size |
| `MONGO_TIMEOUT_MS` | `3000` | App default | MongoDB server selection timeout (ms) |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000` | App default | Login rate-limit window (ms) |
| `LOGIN_RATE_LIMIT_MAX` | `10` | App default | Max failed logins per IP per window |
| `REGISTER_RATE_LIMIT_MAX` | `60` | App default | Max registrations per IP per minute |
| `TRANSFER_RATE_LIMIT_MAX` | `60` | App default | Max import/export requests per IP per minute |
| `MEEMO_PORT` | — | `3000` | Host port mapped to container port `3000` |
| `MCP_ENABLED` | `false` | Not forwarded | Exact `'true'` enables MCP + OAuth assistant access |
| `MCP_PUBLIC_URL` | Unset | Not forwarded | Fixed HTTPS origin in MCP full/setup mode |
| `MCP_REDIRECT_URIS` | Unset | Not forwarded | Exact approved HTTPS callback URIs (comma-separated, no spaces) |
| `MCP_ALLOWED_ORIGINS` | Public origin only | Not forwarded | Optional comma-separated HTTPS browser origins |
| `MCP_BOOTSTRAP_UNTIL` | Unset | Not forwarded | Setup-only UTC deadline (`<= 30m`); requires `MCP_ENABLED=false` |
| `MCP_PROTOCOL_DEADLINE_MS` | `15000` | Not forwarded | Timeout (ms) for `/mcp` protocol requests |

See `.env.example` for non-secret keys. Node does not load `.env` automatically; pass environment variables explicitly (`docker-compose.yml` does not forward MCP keys).

## Gemini assistant (optional)

Meemo supports optional, default-disabled MCP v2 + OAuth 2.1 access (`search_notes`, `get_note`, `batch_get_notes`, `list_tags`, `create_note`, `update_note`, `delete_note`, `batch_delete_notes`) managed under **Settings → Manage assistant connections**. See [Gemini assistant](docs/GEMINI_ASSISTANT.md) for [safe callback discovery](docs/GEMINI_ASSISTANT.md#discover-the-actual-gemini-callbacks-safely), [deliberate enablement](docs/GEMINI_ASSISTANT.md#enable-deliberately), budgets, and recovery.

## Development

Requirements: Node.js 24+, npm, and Docker.

```sh
npm ci
npm --prefix web ci
npm run build
./localdevelopment
```

- `npm run build` compiles `web/` into `web/dist/` and copies into `public/` (`npm run build:web` updates only `web/dist/`).
- Run `npm test` for Mocha backend/Mongo tests (starts a temporary `mongo:8` container), `npm --prefix web test` for Vitest frontend tests, or targeted checks in [Contribution guide](CONTRIBUTING.md#validation). Run `npm run verify` only when the full CI quality + Compose integration gate is needed.
- To run Node against an external MongoDB instance, use `npm start`.

## Production deployment

Production MongoDB is independently deployed on the host (`/home/lin/meemo` Compose config; shared with travel-cards). From a clean committed checkout when deployment is authorized, run `./deploy.sh` to build `meemo:latest` and replace only the `meemo` container with automatic health verification and rollback. Keep source/build work in the Git checkout, production config/data in `/home/lin/meemo`, and backups/recovery artifacts outside both. See [Deployment and releases](docs/RELEASE_CHECKLIST.md) and [Architecture](docs/ARCHITECTURE.md).

## Project structure

| Path | Contents |
| --- | --- |
| `app.js`, `src/lifecycle.js` | Runtime startup (`startServer`), MongoDB pool lifecycle, graceful shutdown |
| `src/http/` | Express app, sessions, uploads, REST routes, Zod validation, optional MCP v2 + OAuth 2.1 handlers |
| `src/services/` | Domain logic (auth, notes, search, attachments, sharing, RSS, settings, health, import/export, MCP) |
| `src/database/` | MongoDB persistence (`things`, `settings`, `users`, `mcp_*`) |
| `src/storage/` | Filesystem attachments and temporary MCP setup callback storage |
| `src/users.js` | User account operations and bcrypt hashing |
| `types/generated/` | Generated OpenAPI TypeScript types (`npm run api:generate`) |
| `scripts/` | Frontend build, orphan attachment GC, quality/Compose verification |
| `src/test/` | Mocha backend & contract tests |
| `web/` | Vue 3 + Vite + TypeScript frontend and Vitest tests |
| `docs/` | [Documentation index](docs/README.md), OpenAPI spec, architecture, and runbooks |
| `public/`, `web/dist/` | Generated build artifacts (do not hand-edit or commit) |

## Docs & license

- [Documentation index](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Design system](DESIGN.md) · [Contribution guide](CONTRIBUTING.md)
- [Gemini assistant](docs/GEMINI_ASSISTANT.md) · [Backup and restore](docs/BACKUP_RESTORE.md) · [Release checklist](docs/RELEASE_CHECKLIST.md) · [Security policy](SECURITY.md)

Meemo is licensed under the [MIT License](LICENSE).
