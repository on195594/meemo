# Architecture

Meemo is a small browser application served by Express and backed by MongoDB and a filesystem attachment store.

## Runtime flow

1. `app.js` creates the Express application, session store, authentication middleware, routes, and MongoDB connection.
2. `src/routes.js` validates HTTP input and translates HTTP requests and responses.
3. `src/logic.js` implements note, import/export, attachment, and Markdown behavior.
4. `src/database/` reads and writes MongoDB collections.
5. `frontend/` is compiled by Gulp into the generated, ignored `public/` directory.

Keep HTTP concerns in `src/routes.js`, application behavior in `src/logic.js`, and persistence in `src/database/`. Reuse these layers instead of accessing MongoDB directly from a route.

## Data and authentication

| Data | Storage |
| --- | --- |
| Notes, tags, settings, sessions | MongoDB |
| Attachments | `ATTACHMENT_DIR` |
| Accounts | `USERS_FILE` JSON file |

Meemo supports username/password authentication only. Passwords are stored as bcrypt hashes, and successful login creates a server-side session backed by MongoDB.

## HTTP surface

Routes are registered in `app.js`:

- `/api/register`, `/api/login`, `/api/logout`: local authentication
- `/api/things`, `/api/files`, `/api/tags`, `/api/settings`: authenticated application API
- `/api/import`, `/api/export`: archive transfer
- `/api/public/*`, `/api/rss/*`, `/public/*`: public streams and feeds
- `/api/healthcheck`: container health probe

When changing an endpoint, update its route handler and the corresponding browser call under `frontend/js/`. Add or update a test under `src/test/` for non-trivial server behavior.

## Build and deployment

`npm run build` compiles `frontend/` into `public/`. Do not commit generated output.

The Dockerfile uses a builder stage for frontend assets and dependencies, then runs the application as an unprivileged user. `docker-compose.yml` supplies MongoDB and persistent named volumes.
