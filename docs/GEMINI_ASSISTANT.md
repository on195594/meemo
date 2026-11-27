# Gemini assistant: MCP integration

Meemo includes optional, default-disabled MCP + OAuth 2.1 read/write note tools for Gemini custom apps. No Gemini API key is required.

## Discover the actual Gemini callbacks safely

When exact Gemini callback URLs are unknown, open a short-lived **setup-only** window (mutually exclusive with enabled mode):

```sh
MCP_ENABLED=false
MCP_PUBLIC_URL=https://notes.example.com
MCP_BOOTSTRAP_UNTIL=<absolute-UTC-deadline-within-30-minutes>
MCP_ALLOWED_ORIGINS=https://gemini.google.com
```

- Leave `MCP_REDIRECT_URIS` unset and pass the ISO UTC timestamp explicitly to the container. After the deadline (including restarts), setup closes and ordinary REST remains unaffected.
- Setup exposes discovery and a 401 MCP challenge, **always rejects** DCR registration, authorization, tokens, revocation, and `/api/mcp/*`, and skips initializing the OAuth repository or note tools.
- `src/storage/mcp-bootstrap.js` captures only canonical HTTPS `/a/` or `/r/` callbacks on `oauth-redirect.googleusercontent.com`, `oauth-redirect-test.googleusercontent.com`, and `oauth-redirect-sandbox.googleusercontent.com` in private temporary storage (`/tmp/meemo-mcp-bootstrap-*`, dir `0700`, file `0600`, max 10 submissions × 10 URLs × 512 chars, cleared at expiry/restart).
- Read `callbacks.json` directly inside the container; never expose it over HTTP or log Google identifiers. Correlate timestamps with the user's connection attempt, review exact callbacks, then remove `MCP_BOOTSTRAP_UNTIL` and set `MCP_ENABLED=true` + `MCP_REDIRECT_URIS`. Full registration accepts up to 10 callbacks and rejects the whole list if any URL is unapproved.

## Enable deliberately

Set these environment variables inside the Node/app container only when authorized:

```sh
MCP_ENABLED=true
MCP_PUBLIC_URL=https://notes.example.com
MCP_REDIRECT_URIS=https://approved-client.example/oauth/callback
# Optional comma-separated HTTPS browser origins (no spaces):
MCP_ALLOWED_ORIGINS=https://gemini.google.com
```

- `MCP_PUBLIC_URL` must be a bare origin (HTTPS in production; HTTP allowed only for `localhost`/`127.0.0.1` in development). Also set HTTPS `APP_ORIGIN` (session cookie `Secure` flag) and required `SESSION_SECRET`. Enabled mode fails startup on invalid settings.
- In Docker/Compose, pass MCP variables into the container environment explicitly (the repo `docker-compose.yml` does not forward them).
- Reverse proxies must forward the expected `Host`, preserve `Authorization`, and validate `Origin` (only approved browser origins receive CORS headers and `WWW-Authenticate` visibility).

## Connect and revoke

1. Open **Settings → Manage assistant connections** (`/assistant/connections`) and add `https://notes.example.com/mcp` in Gemini Custom apps.
2. Authentication uses DCR + OAuth 2.1 authorization code + PKCE S256 for exact resource `/mcp` (`none` or `client_secret_post`; no `client_credentials`, Basic auth, or refresh tokens).
3. Login + explicit acknowledgment of private-note transfer to Google are required before approving `notes.read` or `notes.write`. Consent claims are single-use and bound to canonical user IDs.
4. Grants remain valid **indefinitely until revoked** on `/assistant/connections`; codes expire in 3 minutes and pending consent in 10 minutes. Revoking affects only that user's grant; logging out does not revoke OAuth tokens. Deleted/disabled accounts fail closed on every call.

## Tools, concurrency, and budgets

| Tool | Scope | Behavior |
| --- | --- | --- |
| `search_notes` | `read` / `write` | Existing regex/text search over non-deleted, non-archived notes (300-char summary, optional `include_content: true`). Page default 20, max 50, skip max 1000, query max 1000 chars. |
| `get_note` | `read` / `write` | Single non-deleted note (including archived) by ID: ID, `revision`, raw `content` (no HTML, attachments, or URL enrichment). |
| `batch_get_notes` | `read` / `write` | Accepts `ids` (1–20); single `$in` query returning `{ id, revision, content }`, omitting unavailable IDs. |
| `list_tags` | `read` / `write` | Paged tag counts aggregated dynamically from `things.tags` across non-deleted notes. |
| `create_note` | `write` | Creates private note (`revision: 1`, 1–50,000 chars, optional 12-color palette, auto-parsed tags). |
| `update_note` | `write` | Revision-checked (`expectedRevision`) partial update (`content`, `color`, `sticky`, `archived`); rejects public/shared notes and preserves attachments. |
| `delete_note` | `write` | Revision-checked soft delete to Trash; rejects public/shared notes. |
| `batch_delete_notes` | `write` | Accepts `items` (1–20 `{ id, expectedRevision }`), executes sequentially with duplicate serialization, returns `{ deleted, errors }` without rollback. |

- **Scopes & conflicts**: Registration/authorization without explicit scopes grants `notes.read` and `notes.write`; legacy read-only grants stay read-only until re-consented. Stale `expectedRevision` fails with `revision_conflict` (re-read via `get_note` before retrying).
- **Assistant trace**: Writes set a single-level transient `assistant` field (`action`, self-reported client name, timestamp, and `previous` changed fields on update) shown in the UI with **Undo**; cleared on the owner's next REST write or restore, and omitted from exports/MCP reads.
- **Transport & rate limits**:

| Guard | Limit / Behavior |
| --- | --- |
| Streamable HTTP `/mcp` | Stateless JSON POST + OPTIONS only (no SSE/GET, DELETE, or JSON-RPC batch); 256-byte max JSON-RPC `id`; closed connections do not enter transport |
| Request / response budgets | 16 KiB OAuth URL/body/encoded callback (2 KiB header reserve → 400 JSON on oversized redirect); 64 KiB `/mcp` body; 2 KiB `/api/mcp` body; 128 KiB tool response cap |
| Timeouts | `MCP_PROTOCOL_DEADLINE_MS` (default `15000` ms) on `/mcp`; 3,000 ms Mongo `maxTimeMS` on MCP reads/lookups |
| Rate & capacity (per process) | 120 req/min/IP on protocol; 60 req/min per client/user; 16 concurrent MCP calls; soft caps of 500 clients, 20 pending/client, 50 grants/user |

- Private note/tag content is untrusted data, not instructions. No attachment, sharing, import, or general URL-fetch tools are exposed.

## Measuring assistant round trips

Summarize `mcp_tool` audit events on production (`journald` tag `meemo`) without reading note content:

```sh
journalctl CONTAINER_NAME=meemo -o cat --since -7d | grep '"event":"mcp_tool"' \
  | jq -r '[.tool, .result, (.mode // "-"), (if .count == 0 then "empty" else "-" end)] | @tsv' | sort | uniq -c | sort -rn
```

## Reverse proxy and credential hygiene

Route `/mcp`, `/oauth/*`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/api/mcp/*`, and `/assistant/*` directly to Express without SPA interception or caching, preserving `Host` and `Authorization` headers. Ensure proxy logs use `$request_method $uri` without query strings or `Referer` headers. Application audit logs (`mcp_oauth_callback`, `mcp_oauth_redirect_rejected`, `mcp_registration_rejected`, `mcp_tool`) record only structural metrics/outcomes and IDs—never raw secrets, codes, state payloads, note bodies, or search strings.

## Persistence, recovery and rollback

- Five TTL-indexed MongoDB collections (`mcp_clients`, `mcp_requests`, `mcp_codes`, `mcp_grants`, `mcp_tokens`) store credentials/codes as SHA-256 hashes. Treat database dumps containing `mcp_*` as sensitive credentials.
- After restoring a database backup ([Backup and restore](BACKUP_RESTORE.md)), keep `MCP_ENABLED=false` until an authorized recovery step clears or excludes the five `mcp_*` collections so older backups cannot resurrect revoked grants.
- Rollback: set `MCP_ENABLED=false` to make protocol and connection routes immediately return 404 without modifying notes (for permanent access removal, revoke grants explicitly).

## Verification scope

- **Automated (`npm test`, `npm --prefix web test`)**: covers isolated Mongo persistence, SDK HTTP transport, user isolation, confidential/public clients, PKCE/redirect/resource validation, code replay/expiry, CSRF/consent denial, tool output caps, tag pagination, revision conflicts, revocation, and frontend consent/revocation views.
- **Manual real-client acceptance**: local automated suites do not replace end-to-end verification with an actual Gemini client. Re-verify connection, read/search/tags, create/update/trash, `revision_conflict` recovery, read-only scope enforcement, and user revocation after MCP tool, OAuth, scope, or deployment config changes.
