# Gemini assistant: MCP integration

Implementation: MCP assistant integration with reading and editing tools, disabled by default. No Gemini API key is needed.

## Discover the actual Gemini callbacks safely

When the Meemo callback list is not yet known, use a short-lived **setup-only** window instead of guessing URLs or asking the user to copy an undocumented UI field:

```sh
MCP_ENABLED=false
MCP_PUBLIC_URL=https://notes.example.com
MCP_BOOTSTRAP_UNTIL=<absolute-UTC-deadline-within-30-minutes>
MCP_ALLOWED_ORIGINS=https://gemini.google.com
```

The deadline is an ISO UTC timestamp, not the literal placeholder above. Leave `MCP_REDIRECT_URIS` unset during setup. Pass the variables into the container explicitly. Setup and full enabled mode are mutually exclusive. After the deadline (including process restarts), MCP discovery is closed; ordinary REST and notes remain available.

Setup publishes discovery and a 401 MCP challenge, but **always rejects registration**, authorization, token/revocation requests and browser MCP APIs. It does not initialize the OAuth repository, register clients, issue credentials or invoke note tools. Only bounded, canonical HTTPS callbacks on the three observed Google hosts (`oauth-redirect.googleusercontent.com`, `oauth-redirect-test.googleusercontent.com`, `oauth-redirect-sandbox.googleusercontent.com`) with `/a/` or `/r/` user-bound custom-app paths are captured; this is a metadata filter, not proof of caller identity.

Ask the user to open Gemini web → Settings → Connected Apps → Custom apps, enter the actual Meemo `/mcp` URL, and click Next. A failed connection is expected during setup. The operator reads only `callbacks.json` inside the private `/tmp/meemo-mcp-bootstrap-*` directory of the app container. Do not expose that file over HTTP or paste its Google account identifier into public logs/docs. No client names, secrets, tokens or other request fields are captured. Storage is private (directory 0700, file 0600), retains at most 10 submissions × 10 URLs × 512 characters, and is removed at expiry or container replacement.

Correlate the receipt time with the user's attempt, review the Google host/account/app binding with the user, and treat every submitted URL as untrusted until approved. Do not automatically convert captures into a whitelist. Once reviewed, remove `MCP_BOOTSTRAP_UNTIL`, set the exact `MCP_REDIRECT_URIS` and `MCP_ENABLED=true`, then reconnect and complete consent. Full registration accepts at most 10 callbacks and rejects the entire list if any one is unapproved; six Google callback variants fit that bound.

## Enable deliberately

Set these **Node process** environment variables only after deployment authorization:

```sh
MCP_ENABLED=true
MCP_PUBLIC_URL=https://notes.example.com
MCP_REDIRECT_URIS=https://approved-client.example/oauth/callback
# Optional exact HTTPS origins for browser-based MCP clients, comma-separated:
MCP_ALLOWED_ORIGINS=https://gemini.google.com
```

The URLs above are placeholders, not verified Google callback values. Obtain the actual redirect URI from the intended Gemini connection flow/official client metadata and review it before adding it. Google callbacks can contain a client-specific custom-app identifier: a working travel-cards callback is not proof of Meemo's callback. Do not substitute another app's identifier or derive one from the Meemo hostname; obtain the Meemo client's exact value. Do not allow arbitrary domains, wildcard paths, fragments or HTTP callbacks. `MCP_PUBLIC_URL` is a bare origin, without credentials, path, query or fragment. Development permits HTTP only for localhost/127.0.0.1. Enabled mode without valid settings fails startup; unset/false stays disabled.

For Docker/Compose, explicitly pass these variables into the app container's `environment`; exporting them on the host alone does not update a running container. This change does not edit production Compose or restart any service. Preserve the existing session secret, user source and Mongo settings. In production `SESSION_SECRET` is required. Set `APP_ORIGIN` to the HTTPS application origin as well: production session-cookie Secure flags use `APP_ORIGIN`, not `MCP_PUBLIC_URL` alone.

Use a trusted reverse proxy with the expected Host header, HTTPS and the project's session cookie settings. Discovery uses the configured public URL, never an arbitrary request Host. Origin, if present, must match the public origin or `MCP_ALLOWED_ORIGINS`; cookie-authenticated `/api/mcp` only accepts the public origin. No Origin header is expected from some server-to-server clients. Origin is not authentication. Approved browser origins receive CORS on discovery and protocol success/error responses, including access to the `WWW-Authenticate` challenge; unapproved origins are rejected before those headers are added. Preflights are limited too, without credentialed CORS.

## Connect and revoke

1. Open **Settings → Manage assistant connections**, or `/assistant/connections`.
2. Add the displayed `https://notes.example.com/mcp` address as a Gemini custom app. Availability depends on your actual Google account/region; no universal eligibility claim is made.
3. Gemini uses DCR, OAuth authorization code and PKCE S256, with the exact resource `/mcp`. Public clients (`none`) and confidential clients (`client_secret_post`) are supported. There is no client-credentials grant, Basic client authentication or refresh token flow.
4. Meemo asks you to log in and explicitly acknowledge private-note transfer to Google before approving **read access** or **read & write access**, according to the requested scopes. Client names are self-reported metadata, not proof of identity.
5. Authorization lasts **indefinitely until explicitly revoked** by the user in connection settings; reconnect only if you revoke access. Registered clients and tokens persist without automatic 24-hour expiration. Codes last three minutes; pending consent lasts ten minutes. SDK and database checks enforce expiry even before TTL cleanup.
6. Revoke a connection on the same page. Only your grant is revoked; other users of the same client remain connected. Logging out does not revoke tokens. Revocation stops later calls, not in-flight results or content already transmitted.

Browser consent/revocation APIs use the existing session plus a session CSRF token. They do not accept MCP Bearer tokens. Conversely, `/mcp` does not use browser sessions. Consent claims are user-bound and single-use. Username-only legacy sessions must log in again; grants bind canonical stable IDs. Disabled/deleted accounts and canonical-ID mismatches (including usernames matching deleted IDs) fail closed on every call, rather than being treated as another valid identity. Session/token secrets are never displayed in connection management.

## Tools and limits

| Tool | Behavior |
| --- | --- |
| `search_notes` | Existing regex/text search of your non-deleted, non-archived notes. IDs, versions, timestamps, and summaries of at most 300 Unicode characters. Optional `include_content` (boolean, default `false`) adds complete raw Markdown bodies in the same query. |
| `get_note` | Your own non-deleted note by ID, including archived notes. Only ID, version and raw body; no rendered HTML, attachments, download URLs or URL enrichment. |
| `batch_get_notes` | Accepts `ids` (1–20 note IDs) and returns an array of ID, revision and complete raw body in one MongoDB `$in` query. Same ownership/deletion rules as `get_note`; archived notes are included. Unavailable IDs are omitted, duplicates return once, and order is unspecified. |
| `list_tags` | Tags from your non-deleted notes, including archived ones. Uses `things.tags`, not the historical tags projection. |
| `create_note` | Create a new private note. Content is plain text or Markdown; hashtags are parsed into tags automatically. Optional 12-color palette. |
| `update_note` | Update an existing private note by ID with optimistic concurrency control (`expectedRevision`). Can update content, color, archive status, or sticky pin. |
| `delete_note` | Move a private note to trash with optimistic concurrency control (`expectedRevision`). The note can be restored in the web interface. |
| `batch_delete_notes` | Accepts `items` (1–20 objects with `id` and `expectedRevision`). Reuses single-note deletion checks and soft deletion sequentially. Returns `{ deleted: [id, ...], errors: [{ id, code }, ...] }`; failed items do not roll back successful ones. |

Read tools accept `notes.read` or `notes.write`; write tools (`create_note`, `update_note`, `delete_note`, `batch_delete_notes`) strictly require `notes.write`. All eight tools are listed even for read-only grants, but unauthorized calls fail with `insufficient_scope`. Registration without an explicit scope defaults to both scopes; authorization without a scope uses the registered client's scopes. Write authorization includes read access. Existing grants without stored scopes remain read-only and require new consent to gain write access. The server derives user identity from the grant, never tool arguments.

Batch tools use one ordinary `tools/call` request and one scope check for the whole batch; they do not invoke separate tools or request consent per note. Client-side confirmation prompts depend on the client and require real-client acceptance. A batch deletion is not a transaction: inspect both `deleted` and `errors`, and re-read current revisions before retrying failed items. Repeating a deleted ID reports `not_found` for later occurrences.

Creation returns ID and revision 1. Updates and deletion require the latest `expectedRevision`; stale revisions or concurrent write races fail with `revision_conflict`. When a `revision_conflict` occurs, client/assistant recovery must re-read the latest note state using `get_note` and reconcile changes before retrying. Public or shared notes cannot be updated or deleted through MCP. Create/update content is limited to 1–50,000 characters; an update must include at least one supported field (content, color, sticky, or archived). Partial-field updates strictly preserve all unmentioned properties, including existing attachments. Writing does not expose attachment upload/download, sharing, restore or permanent-deletion tools; deletions move notes to trash (recoverable in the web interface, never permanently purged). A timed-out response is not proof a write failed; inspect the note before retrying, especially creation, which has no idempotency key.

Page default 20, maximum 50, skip maximum 1000; `hasMore` indicates another page (beyond the skip bound, refine search/use Meemo). Search query maximum 1000 characters. Full tool responses are capped at 128 KiB, accounting for serialized content and protocol envelope headroom. Oversized bodies return an error, not a silently truncated note. Large bodies remain readable in the ordinary Meemo UI.

MCP uses stateless Streamable HTTP with JSON responses: single POST requests, OPTIONS preflight, no JSON-RPC batch arrays, persistent SSE/GET stream or DELETE session. JSON-RPC IDs are limited to 256 serialized UTF-8 bytes (including quotes/escaping), preserving the response envelope budget. Closed connections cannot reserve new concurrency slots or enter transport after asynchronous authentication/connection setup. Opaque OAuth `state` is preserved unchanged through consent and callback, with a 4096-character maximum (Gemini account-linking requests can exceed 1000 characters). OAuth/protocol body caps are 16/64 KiB; cookie-authenticated MCP API JSON bodies are limited to 2 KiB before the ordinary REST parser. Protocol requests have a 15-second absolute deadline; MCP read queries and credential lookups use three-second Mongo execution limits where available. Closed sockets do not cancel already-running reads; Mongo time limits bound these operations.

Limits per app process: 120 protocol requests/minute/IP; 60 MCP requests/minute/client and user; 16 simultaneous authenticated MCP requests. Browser connection APIs are separately limited by IP and user. Registration/consent capacity guards are soft concurrency limits: 500 live clients, 20 pending requests/client, 50 live grants/user; concurrent requests can briefly exceed these counts. Rate state resets on restart; coordinate it before adding replicas. Tag grouping still scans user data despite paged output, so execution limits and throttling remain necessary.

Every successful write records a visible trace on the note: `assistant.action` (`create`, `update` or `delete`), the client's self-reported registration name, the time and, for updates, the previous values of only the fields that changed. The web UI labels such notes (for example “Gemini edited”) and offers **Undo** for updates; Undo is an ordinary revision-checked save. The owner's next web write or restore clears the trace, so only the latest assistant write is undoable. Traces are not exported and are not returned by MCP tools.

Private note and tag content is untrusted data, not an instruction. No attachment uploads, public sharing, imports, account changes, or general URL/network tools are exposed.

## Reverse proxy and credential hygiene

Route `/mcp`, `/oauth/*`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/api/mcp/*` and `/assistant/*` to this application without SPA interception or caching. Preserve Host and Authorization; do not rewrite resource URLs or redirect the discovery endpoint. MCP requires both JSON and event-stream in the client's Accept header as checked by the SDK, even though successful responses here are JSON.

The app sets no-store for protocol/browser API responses and no-referrer/no-store for assistant HTML. If the proxy serves the SPA HTML itself, apply equivalent headers there too. Do not log OAuth query strings, consent request IDs, Authorization, Cookie, client secrets, codes, CSRF values or Referer. A proxy access format using `$request` or `$request_uri` leaks query values; use `$request_method $uri` and omit Referer for these routes. Application HTTP logs omit query strings; tool audit includes request/user/client IDs, tool, note ID where applicable, outcome and duration, never body or search terms.

## Persistence, recovery and rollback

Five `mcp_*` collections store clients, pending requests, codes, grants and hashed tokens; each has an expiry TTL index. Credentials/codes/consent handles are stored as SHA-256 hashes; opaque values come from Node's cryptographic RNG, while the official SDK validates PKCE. Store no raw token or client secret in logs or backups. Grant/account references and pending consent metadata are still sensitive.

Follow [backup/restore](BACKUP_RESTORE.md). Database dumps include these collections unless excluded: protect them like sessions and accounts. After restoring a database, keep `MCP_ENABLED=false` until an explicitly authorized recovery step invalidates restored OAuth state (exclude `mcp_*` on restore, or clear those five collections in the isolated restored target after checking its identity). Never run such cleanup against a live database under this document's authority. Revoked grants from an older backup must not be resurrected. Clients reconnect/re-register afterward; ordinary notes do not depend on OAuth state.

Rollback can disable MCP without dropping collections or editing notes. Disabling immediately makes protocol and connection APIs return 404; re-enabling before grant expiry makes still-valid grants usable again. If the intention is permanent access removal, revoke grants separately with authorization rather than treating the feature flag as revocation.

## Evidence and acceptance

Tests cover real isolated Mongo persistence and SDK HTTP transport, user separation, confidential/public clients, PKCE/resource/redirect checks, code replay/expiry, CSRF/consent denial, tool schemas/output limits, tag pagination, scoped writes, revision conflicts, public/shared-note write rejection, legacy read-only grants, grant/token expiry, revocation and REST/Bearer separation. Frontend behavior tests cover read/write consent wording, acknowledgement, denial, error states, stale responses and connection revocation.

Real-client acceptance: **PASS** (maintainer manual acceptance, recorded 2026-10-22). The maintainer reported completing the production Gemini acceptance by hand; client versions and per-check details were not recorded in this repository. The acceptance scope is connection, search/read/tags, create/update/trash, stale-revision rejection and conflict recovery, partial-field updates, read-only scope enforcement, and user-level revocation.

Repeat that scope after changes to MCP tools, OAuth, scopes or deployment settings. Record client/version, deployment version and dates without private note content or credentials. Local unit/integration test passes do not replace real-client acceptance.
