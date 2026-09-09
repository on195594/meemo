# Meemo

Meemo is a self-hosted manager for notes, ideas, links, bookmarks, and tasks. It uses username/password authentication, MongoDB for application data and sessions, and the local filesystem for accounts and attachments.

## Features

- Markdown notes with tags and full-text search
- Attachments, archive, sticky notes, and public sharing
- Public feeds and RSS
- JSON archive import and export
- Local username/password accounts with bcrypt password hashes
- Docker Compose deployment

## Quick start

Requirements: Docker with Docker Compose.

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Open <http://localhost:3000>, register an account, and sign in. View logs with `docker compose logs -f` and stop the stack with `docker compose down`.

> Registration is currently public. Put Meemo behind an access-controlled network or reverse proxy if account creation must be restricted.

## Authentication and storage

Meemo supports username/password authentication only. Passwords are stored as bcrypt hashes in the file configured by `USERS_FILE`; successful logins create server-side sessions stored in MongoDB.

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
| `SESSION_SECRET` | Random on startup | Value of host `SESSION_SECRET` | Session signing secret |
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

`npm run build` compiles `frontend/` into the ignored `public/` directory. `npm test` starts and removes a temporary MongoDB container. `./localdevelopment` starts a reusable development MongoDB container and the application.

To run only the Node.js process, provide MongoDB separately and use `npm start`.

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Express entry point, sessions, authentication, routes, and startup |
| `src/routes.js` | HTTP handlers and authorization |
| `src/logic.js` | Application behavior |
| `src/database/` | MongoDB persistence |
| `src/users.js` | Account and password handling |
| `src/test/` | Mocha tests |
| `frontend/` | Browser source compiled into `public/` |
| `docs/` | Architecture and maintenance documentation |
| `Dockerfile`, `docker-compose.yml` | Container build and deployment |
| `.github/` | Continuous integration and repository configuration |

Do not commit generated `public/`, `node_modules/`, account files, attachments, or database data.

## Contributing and security

- [Contribution guide](CONTRIBUTING.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security policy](SECURITY.md)

## License

Meemo is available under the [MIT License](LICENSE).
