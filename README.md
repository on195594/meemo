# Meemo

Meemo is a personal manager for notes, ideas, links, bookmarks, and tasks. This repository is the canonical source for both application development and container builds.

## Authentication

The default Docker deployment uses local username/password authentication. No OIDC provider is required.

Users register through Meemo and credentials are stored as bcrypt password hashes in `/app/data/.users.json` inside the persistent `meemo_data` Docker volume. The development-only mock OIDC callback is not enabled in this mode, so local sessions cannot bypass password verification.

Cloudron OIDC remains supported when `CLOUDRON_OIDC_ISSUER`, `CLOUDRON_OIDC_CLIENT_ID`, and `CLOUDRON_OIDC_CLIENT_SECRET` are provided.

For stable sessions across container restarts, set a strong `SESSION_SECRET`. If it is omitted, Meemo generates a random process-local secret and existing sessions are invalidated after restart.

## Development

Requirements:

- Node.js 18 or newer
- npm
- Docker

Install dependencies and build the frontend:

```sh
npm ci
npm run build
```

Run the test suite:

```sh
npm test
```

The test script starts a temporary MongoDB container.

## Local development

Build the frontend once, then start the application and its MongoDB container:

```sh
npm ci
npm run build
./localdevelopment
```

## Docker deployment

Build the current checkout and start Meemo with MongoDB:

```sh
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build -d
```

Meemo is available at <http://localhost:3000>.

The Compose stack uses named volumes:

- `meemo_data` for the local user database and attachments
- `mongodb_data` for MongoDB data

No host-side `touch`, `mkdir`, or `chown` preparation is required.

To use a public hostname or reverse proxy, set `CLOUDRON_APP_ORIGIN` to the externally visible origin before starting the stack.

The Dockerfile builds frontend assets and runtime dependencies directly from this repository. It does not clone another Meemo repository or release during the build.

GitHub Actions validate Docker builds locally and do not push images to Docker Hub or another remote registry.

### Environment variables

| Variable | Container default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `BIND_ADDRESS` | `0.0.0.0` | HTTP listen address |
| `CLOUDRON_MONGODB_URL` | `mongodb://mongodb:27017/meemo` | MongoDB connection URL |
| `CLOUDRON_APP_ORIGIN` | `http://localhost:3000` | Public application origin and OIDC callback base URL |
| `ATTACHMENT_DIR` | `/app/data/storage` | Persistent attachment directory |
| `CLOUDRON_LOCAL_AUTH_FILE` | `/app/data/.users.json` | Local username/password data file |
| `SESSION_SECRET` | generated when unset | Express/OIDC session signing secret |
| `CLOUDRON_OIDC_ISSUER` | unset | Optional Cloudron OIDC issuer; unset uses local username/password authentication |
| `CLOUDRON_OIDC_CLIENT_ID` | unset | Optional Cloudron OIDC client ID |
| `CLOUDRON_OIDC_CLIENT_SECRET` | unset | Optional Cloudron OIDC client secret |

`CLOUDRON_USERS_FILEPATH` remains accepted as a legacy fallback when `CLOUDRON_LOCAL_AUTH_FILE` is not set.

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Express application entry point, sessions, local auth/OIDC integration, and MongoDB startup |
| `src/` | Server routes, application logic, persistence, users, and tests |
| `frontend/` | Browser UI source compiled by Gulp into `public/` |
| `webextension/` | Browser-extension source |
| `gulpfile.js` | Frontend and extension build tasks |
| `Dockerfile`, `docker-compose.yml` | Container build and local deployment |
| `.github/` | GitHub Actions and repository governance files |

## Repository history

The application source and its commit history were developed in `on195594/meemoo`. They were merged into `on195594/meemo` with an unrelated-histories merge so both repositories' commits remain reachable. `on195594/meemo` is the canonical repository for ongoing maintenance and development.

## License

Meemo is available under the [MIT License](LICENSE).
