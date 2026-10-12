# Gemini assistant: read-only MCP

Implementation: phase 1 only, disabled by default. Meemo's real Gemini web/mobile acceptance is **pending**; travel-cards' user-confirmed acceptance is a reference, not a Meemo test result. No Gemini API key is needed.

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
4. Meemo asks you to log in and explicitly acknowledge private-note transfer to Google before approving **read access**. Client names are self-reported metadata, not proof of identity.
5. Authorization lasts up to **24 hours**; reconnect after expiry. Registered clients expire after 30 days and must be registered again. Codes last three minutes; pending consent lasts ten minutes. SDK and database checks enforce expiry even before TTL cleanup.
6. Revoke a connection on the same page. Only your grant is revoked; other users of the same client remain connected. Logging out does not revoke tokens. Revocation stops later calls, not in-flight results or content already transmitted.

Browser consent/revocation APIs use the existing session plus a session CSRF token. They do not accept MCP Bearer tokens. Conversely, `/mcp` does not use browser sessions. Consent claims are user-bound and single-use. Username-only legacy sessions must log in again; grants bind canonical stable IDs. Disabled/deleted accounts and canonical-ID mismatches (including usernames matching deleted IDs) fail closed on every call, rather than being treated as another valid identity. Session/token secrets are never displayed in connection management.

## Tools and limits

| Tool | Behavior |
| --- | --- |
| `search_notes` | Existing regex/text search of your non-deleted, non-archived notes. IDs, versions, timestamps, and summaries of at most 300 Unicode characters; no full bodies. |
| `get_note` | Your own non-deleted note by ID, including archived notes. Only ID, version and raw body; no rendered HTML, attachments, download URLs or URL enrichment. |
| `list_tags` | Tags from your non-deleted notes, including archived ones. Uses `things.tags`, not the historical tags projection. |

All tools require `notes.read`; the server derives user identity from the grant, never tool arguments. Page default 20, maximum 50, skip maximum 1000; `hasMore` indicates another page (beyond the skip bound, refine search/use Meemo). Search query maximum 1000 characters. Full tool responses are capped at 128 KiB, accounting for serialized content and protocol envelope headroom. Oversized bodies return an error, not a silently truncated note. Large bodies remain readable in the ordinary Meemo UI.

MCP uses stateless Streamable HTTP with JSON responses: single POST requests, OPTIONS preflight, no batch arrays, persistent SSE/GET stream or DELETE session. JSON-RPC IDs are limited to 256 serialized UTF-8 bytes (including quotes/escaping), preserving the response envelope budget. Closed connections cannot reserve new concurrency slots or enter transport after asynchronous authentication/connection setup. OAuth/protocol body caps are 16/64 KiB; cookie-authenticated MCP API JSON bodies are limited to 2 KiB before the ordinary REST parser. Protocol requests have a 15-second absolute deadline; MCP read queries and credential lookups use three-second Mongo execution limits where available. Closed sockets do not cancel already-running reads; Mongo time limits bound these operations.

Limits per app process: 120 protocol requests/minute/IP; 60 MCP requests/minute/client and user; 16 simultaneous authenticated MCP requests. Browser connection APIs are separately limited by IP and user. Registration/consent capacity guards are soft concurrency limits: 500 live clients, 20 pending requests/client, 50 live grants/user; concurrent requests can briefly exceed these counts. Rate state resets on restart; coordinate it before adding replicas. Tag grouping still scans user data despite paged output, so execution limits and throttling remain necessary.

Private note and tag content is untrusted data, not an instruction. No writes, deletion, sharing, attachments, imports, account changes, or general URL/network tools are exposed. Writing remains gated by the [plan](roadmaps/2026-10-12-gemini-assistant-integration.md).

## Reverse proxy and credential hygiene

Route `/mcp`, `/oauth/*`, `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp`, `/api/mcp/*` and `/assistant/*` to this application without SPA interception or caching. Preserve Host and Authorization; do not rewrite resource URLs or redirect the discovery endpoint. MCP requires both JSON and event-stream in the client's Accept header as checked by the SDK, even though successful responses here are JSON.

The app sets no-store for protocol/browser API responses and no-referrer/no-store for assistant HTML. If the proxy serves the SPA HTML itself, apply equivalent headers there too. Do not log OAuth query strings, consent request IDs, Authorization, Cookie, client secrets, codes, CSRF values or Referer. A proxy access format using `$request` or `$request_uri` leaks query values; use `$request_method $uri` and omit Referer for these routes. Application HTTP logs omit query strings; tool audit includes request/user/client IDs, tool, note ID where applicable, outcome and duration, never body or search terms.

## Persistence, recovery and rollback

Five `mcp_*` collections store clients, pending requests, codes, grants and hashed tokens; each has an expiry TTL index. Credentials/codes/consent handles are stored as SHA-256 hashes; opaque values come from Node's cryptographic RNG, while the official SDK validates PKCE. Store no raw token or client secret in logs or backups. Grant/account references and pending consent metadata are still sensitive.

Follow [backup/restore](BACKUP_RESTORE.md). Database dumps include these collections unless excluded: protect them like sessions and accounts. After restoring a database, keep `MCP_ENABLED=false` until an explicitly authorized recovery step invalidates restored OAuth state (exclude `mcp_*` on restore, or clear those five collections in the isolated restored target after checking its identity). Never run such cleanup against a live database under this document's authority. Revoked grants from an older backup must not be resurrected. Clients reconnect/re-register afterward; ordinary notes do not depend on OAuth state.

Rollback can disable MCP without dropping collections or editing notes. Disabling immediately makes protocol and connection APIs return 404; re-enabling before grant expiry makes still-valid grants usable again. If the intention is permanent access removal, revoke grants separately with authorization rather than treating the feature flag as revocation.

## Evidence and pending acceptance

Tests cover real isolated Mongo persistence and SDK HTTP transport, user separation, confidential/public clients, PKCE/resource/redirect checks, code replay/expiry, CSRF/consent denial, tool schemas/output limits, tag pagination, grant/token expiry, revocation and REST/Bearer separation. Frontend behavior tests cover acknowledgement, denial, error states, stale responses and connection revocation.

Before production: authorize deployment separately, verify public discovery/callback/Origin settings and session cookies, then perform Meemo real Gemini web/mobile tests for connection, search/read/tags, 24-hour renewal and revocation. Record client/version, deployment version and dates without private note content or credentials. Unit/integration passes and an independent scoped review are not those acceptance results.
