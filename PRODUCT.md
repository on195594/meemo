# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosted individuals, developers, and knowledge workers managing personal notes, quick ideas, task lists, bookmarks, and multimedia attachments in a private, unmetered environment.

## Product Purpose

A responsive, self-hosted scratchpad and note-taking web application inspired by Google Keep and Material Design 3. Meemo provides an instant, low-friction environment to capture thoughts, format with Markdown, organize via tags and colors, and retrieve with relevance-scored full-text search without vendor lock-in or a mandatory cloud service.

## Positioning

Unlike cloud note services, Meemo is self-hosted (Docker, MongoDB, local filesystem attachments) and keeps accounts, notes, and attachments on the operator's own host. It combines Google Keep-style color organization and fast capture with Markdown, wikilinks, and full-text search. Optional assistant read access is a separate privacy decision: retrieved private note content may be sent to Google.

## Operating Context

- Web browser running on desktop and mobile viewports, accessed directly on local networks or behind private reverse proxies (e.g. Nginx with SSL).
- Fast capture workflow: rapid creation via a Keep-style "Take a note…" composer that saves when closed or clicked away from, instant search navigation via keyboard shortcuts (`/` and `Ctrl+K`), live tag filtering (`#tag`).
- Focused editing: Google Keep-style dialog that opens ready to edit (separate title field mapped to a leading `# Title` line, Markdown body) and saves on close; checklist items toggle directly on cards; writes use revision-checked (CAS) updates.
- Triage and organization: Pinning notes to top, 12-color high-contrast palette tinting, duplicating notes ("Make a copy"), archiving completed notes, and reversible trash.

## Capabilities and Constraints

- **Client**: Modern Vue 3 Single Page Application with TypeScript, Vite, Material Design 3 tokens, client-side routing, and responsive height-balanced masonry layout (grid or list view), and a Keep-style navigation rail (Notes, Archive, Trash).
- **Server & Persistence**: Node.js/Express backend with Zod validation, MongoDB for accounts, sessions, and unified `things` collections with compound ESR and `$text` indexes, local filesystem for attachments.
- **Content Formatting**: Markdown rendering, interactive task checkboxes, wikilinks, search-term highlighting.
- **Organization**: Pinned notes section, 12-color Keep-calibrated palette with automatic dark mode contrast recalibration, dynamic tag aggregation, single-note actions (copy, pin, archive, public/private toggle, delete) via touch-friendly action menus, multi-select batch actions (pin, archive, color, delete to trash), and snackbar Undo for archive and trash.
- **Import/Export**: Drag-and-drop `.tar` archive import with progress tracking; `.tar` export (`/api/export`).
- **Authentication**: Browser username/password login with bcrypt hashing, server-side MongoDB sessions, configurable registration modes (`open`, `first-user`, `disabled`). MCP uses separately consented, user-bound OAuth tokens, not REST session substitution.
- **Optional assistant**: Default-disabled Gemini/MCP integration supporting note search, read, create, update, and delete with optimistic concurrency control. Private-note transfer requires explicit user consent. See [current configuration and boundaries](docs/GEMINI_ASSISTANT.md).
- **Constraints**: Self-hosted only; URL enrichment (outbound fetch) is disabled by default for SSRF safety; note colors are designed toward WCAG AA contrast (not formally audited).

## Brand Commitments

- Name: Meemo. Existing visual direction (Material Design 3 tokens, Google Keep-style 12-color notes) is incumbent, documented in [DESIGN.md](DESIGN.md).
- Voice, personality, and any further brand constraints: undecided (init interview not run; infer nothing beyond the repository).

## Evidence on Hand

- Vue 3 frontend (`web/src/`) validated by build, typecheck and Vitest component/store/route behavior tests. Exact counts belong in dated validation records, not this product baseline.
- Express runtime covered by Mocha server and integration tests.
- Authoritative OpenAPI 3.0 specification (`docs/openapi.yaml`) and TypeScript domain definitions (`types/api.d.ts`).
- Docker Compose packaging with healthchecks and graceful shutdown; candidate releases require the [release checklist](docs/RELEASE_CHECKLIST.md). MCP real Gemini client acceptance passed by maintainer manual test (recorded 2026-10-22).

## Product Principles

1. **Capture First**: The input bar is prominent and ready. Opening and composing notes takes zero unnecessary friction; autosave protects against data loss.
2. **Calm Hierarchy**: Chrome recedes into the background. Note cards are clear, comfortable, and tactile; color functions as an organizational aid rather than visual noise.
3. **Data Sovereignty**: Persistent notes and attachments stay on the operator's host; archive import and export keep notes portable. No external AI service is required; opt-in assistant access explicitly permits private content to leave the host.
4. **Keyboard & Accessibility by Default**: Keyboard shortcuts (`/`, `Ctrl+K`, `Esc`), ARIA landmarks, and visible focus.

## Provenance

Drafted from repository evidence (README, docs/ARCHITECTURE.md, web/src) without the init interview; confirm Users, Positioning, and Brand Commitments with the maintainer.

## Accessibility & Inclusion

- Target: WCAG AA contrast across light and dark themes and all 12 note colors (not formally verified).
- Standard dialog focus management with `Esc` dismiss and backdrop traps.
- Semantic HTML landmarks (`header`, `main`, `section`, `nav`).
- Respects `prefers-reduced-motion` across all transitions and animations.
