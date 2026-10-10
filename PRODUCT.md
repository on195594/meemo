# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosted individuals, developers, and knowledge workers managing personal notes, quick ideas, task lists, bookmarks, and multimedia attachments in a private, unmetered environment.

## Product Purpose

A responsive, self-hosted scratchpad and note-taking web application inspired by Google Keep and Material Design 3. Meemo provides an instant, low-friction environment to capture thoughts, format with Markdown, organize via tags and colors, and retrieve with relevance-scored full-text search without vendor lock-in or cloud privacy compromises.

## Positioning

Unlike cloud note services, Meemo is self-hosted (Docker, MongoDB, local filesystem attachments) and keeps accounts, notes, and attachments on the operator's own host. It combines Google Keep-style color organization and fast capture with Markdown, wikilinks, and full-text search.

## Operating Context

- Web browser running on desktop and mobile viewports, accessed directly on local networks or behind private reverse proxies (e.g. Nginx with SSL).
- Fast capture workflow: rapid creation via top stream composer, instant search navigation via keyboard shortcuts (`/` and `Ctrl+K`), live tag filtering (`#tag`).
- Focused editing: Google Keep-inspired modal dialog with Markdown edit/preview toggle and task toggling; writes use revision-checked (CAS) updates.
- Triage and organization: Pinning notes to top, 12-color high-contrast palette tinting, archiving completed notes, and reversible trash.

## Capabilities and Constraints

- **Client**: Modern Vue 3 Single Page Application with TypeScript, Vite, Material Design 3 tokens, client-side routing, and responsive CSS masonry layout.
- **Server & Persistence**: Node.js/Express backend with Zod validation, MongoDB for accounts, sessions, and unified `things` collections with compound ESR and `$text` indexes, local filesystem for attachments.
- **Content Formatting**: Markdown rendering, interactive task checkboxes, wikilinks, search-term highlighting.
- **Organization**: Pinned notes section, 12-color Keep-calibrated palette with automatic dark mode contrast recalibration, dynamic tag aggregation, multi-select batch actions (pin, archive, color, delete to trash).
- **Import/Export**: Drag-and-drop `.tar` archive import with progress tracking; `.tar` export (`/api/export`).
- **Authentication**: Local username/password authentication with bcrypt hashing, server-side MongoDB sessions, configurable registration modes (`open`, `first-user`, `disabled`).
- **Constraints**: Self-hosted only; URL enrichment (outbound fetch) is disabled by default for SSRF safety; note colors are designed toward WCAG AA contrast (not formally audited).

## Brand Commitments

- Name: Meemo. Existing visual direction (Material Design 3 tokens, Google Keep-style 12-color notes) is incumbent, documented in [DESIGN.md](DESIGN.md).
- Voice, personality, and any further brand constraints: undecided (init interview not run; infer nothing beyond the repository).

## Evidence on Hand

- Verified Vue 3 frontend (`web/src/`) with 98 automated Vitest unit/component behavior tests.
- Express runtime with complete Mocha integration test suite.
- Authoritative OpenAPI 3.0 specification (`docs/openapi.yaml`) and TypeScript domain definitions (`types/api.d.ts`).
- Production-tested Docker Compose stack with healthchecks and graceful shutdown.

## Product Principles

1. **Capture First**: The input bar is prominent and ready. Opening and composing notes takes zero unnecessary friction; autosave protects against data loss.
2. **Calm Hierarchy**: Chrome recedes into the background. Note cards are clear, comfortable, and tactile; color functions as an organizational aid rather than visual noise.
3. **Data Sovereignty**: Data stays on the operator's host; archive import and export keep notes portable.
4. **Keyboard & Accessibility by Default**: Keyboard shortcuts (`/`, `Ctrl+K`, `Esc`), ARIA landmarks, and visible focus.

## Provenance

Drafted from repository evidence (README, docs/ARCHITECTURE.md, web/src) without the init interview; confirm Users, Positioning, and Brand Commitments with the maintainer.

## Accessibility & Inclusion

- Target: WCAG AA contrast across light and dark themes and all 12 note colors (not formally verified).
- Standard dialog focus management with `Esc` dismiss and backdrop traps.
- Semantic HTML landmarks (`header`, `main`, `section`, `nav`).
- Respects `prefers-reduced-motion` across all transitions and animations.
