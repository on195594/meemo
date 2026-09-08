# Meemo

Meemo is a personal manager for notes, ideas, links, bookmarks, and tasks. This repository is the canonical source for both application development and container builds.

## Development

Requirements:

- Node.js 18 or newer
- npm
- Docker, for MongoDB-backed tests and the local-development helper

Install dependencies and build the frontend:

```sh
npm install
npm run build
```

For a reproducible clean install, use `npm ci` instead of `npm install`.

Run the test suite:

```sh
npm test
```

The test script starts a temporary MongoDB container.

## Local development

Build the frontend once, then start the application and its MongoDB container:

```sh
npm install
npm run build
./localdevelopment
```

When `CLOUDRON_OIDC_ISSUER` is unset, Meemo uses its local mock OIDC flow. Set the Cloudron OIDC variables below to exercise a real provider.

## Docker deployment

Prepare writable host paths, build the current checkout, and start Meemo with MongoDB:

```sh
touch users.json
mkdir -p data database
chown 1000:1000 users.json data database
chmod 600 users.json
chmod 700 data database
docker compose up --build -d
```

Meemo is then available at <http://localhost:3000>. The Dockerfile builds the frontend and server dependencies directly from this repository; it does not clone another Meemo release.

### Environment variables

| Variable | Container default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP listen port |
| `BIND_ADDRESS` | `0.0.0.0` | HTTP listen address |
| `CLOUDRON_MONGODB_URL` | `mongodb://mongodb:27017/meemo` | MongoDB connection URL |
| `CLOUDRON_APP_ORIGIN` | `http://localhost:3000` | Public application origin and OIDC callback base URL |
| `ATTACHMENT_DIR` | `/app/data/storage` | Persistent attachment directory |
| `CLOUDRON_LOCAL_AUTH_FILE` | `/app/data/.users.json` | Local username/password data file |
| `CLOUDRON_OIDC_ISSUER` | unset | Cloudron OIDC issuer; unset enables local mock OIDC |
| `CLOUDRON_OIDC_CLIENT_ID` | unset | Cloudron OIDC client ID |
| `CLOUDRON_OIDC_CLIENT_SECRET` | unset | Cloudron OIDC client secret |

`CLOUDRON_USERS_FILEPATH` remains accepted as a legacy fallback when `CLOUDRON_LOCAL_AUTH_FILE` is not set.

For Cloudron packaging, use the included `CloudronManifest.json` and the normal Cloudron CLI workflow:

```sh
cloudron build
cloudron install
```

## Project structure

| Path | Contents |
| --- | --- |
| `app.js` | Express application entry point, sessions, OIDC, and MongoDB startup |
| `src/` | Server routes, application logic, persistence, users, and tests |
| `frontend/` | Browser UI source compiled by Gulp into `public/` |
| `webextension/` | Browser-extension source |
| `gulpfile.js` | Frontend and extension build tasks |
| `Dockerfile`, `docker-compose.yml` | Container build and local deployment |
| `.github/` | GitHub Actions and repository governance files |

## Repository history

The application source and its commit history were developed in `on195594/meemoo`. They were merged into `on195594/meemo` with an unrelated-histories merge so both repositories' commits remain reachable. `on195594/meemo` is now the only repository intended for ongoing maintenance and development; `meemoo` is retained and is not automatically deleted or archived.

## License

Meemo is available under the [MIT License](LICENSE).
