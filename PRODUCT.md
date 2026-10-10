# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Self-hosted individuals, developers, and knowledge workers managing personal notes, quick ideas, task lists, bookmarks, and multimedia attachments in a private, unmetered environment.

## Product Purpose

A responsive, self-hosted scratchpad and note-taking web application inspired by Google Keep and Material Design 3. Meemo provides an instant, low-friction environment to capture thoughts, format with Markdown, organize via tags and colors, and retrieve with relevance-scored full-text search without vendor lock-in or cloud privacy compromises.

## Positioning

Unlike cloud note services (Google Keep, Notion, Apple Notes) that monetize user data, require cloud accounts, or enforce arbitrary limits, Meemo is a self-hosted personal hub powered by Docker, MongoDB, and local filesystem storage. It delivers Google Keep-style spatial color organization and fast capture combined with standard Markdown, wikilinks, offline-feeling speed, and zero telemetry.

## Operating Context

- Web browser running on desktop and mobile viewports, accessed directly on local networks or behind private reverse proxies (e.g. Nginx with SSL).
- Fast capture workflow: rapid creation via top stream composer, instant search navigation via keyboard shortcuts (`/` and `Ctrl+K`), live tag filtering (`#tag`).
- Focused editing: Google Keep-inspired modal dialog with Markdown live preview, task toggling, and revision history.
- Triage and organization: Pinning notes to top, 12-color high-contrast palette tinting, archiving completed notes, and reversible trash.

## Capabilities and Constraints

- **Client**: Modern Vue 3 Single Page Application with TypeScript, Vite, Material Design 3 tokens, client-side routing, and responsive CSS masonry layout.
- **Server & Persistence**: Node.js/Express backend with Zod validation, MongoDB for accounts, sessions, and unified `things` collections with compound ESR and `$text` indexes, local filesystem for attachments.
- **Content Formatting**: Markdown rendering, interactive task checkboxes, syntax highlighting, wikilinks (`[[Note]]`), code block copying.
- **Organization**: Pinned notes section, 12-color Keep-calibrated palette with automatic dark mode contrast recalibration, dynamic tag aggregation, multi-select batch actions (archive, trash, color).
- **Import/Export**: Drag-and-drop `.tar` archive import with progress tracking, full JSON/attachment export.
- **Authentication**: Local username/password authentication with bcrypt hashing, server-side MongoDB sessions, configurable registration modes (`open`, `first-user`, `disabled`).
- **Constraints**: No third-party cloud SDKs or tracking scripts; all assets self-contained; strict adherence to WCAG AA contrast ratios across all 12 note background colors.

## Brand Commitments

- **Aesthetic**: Utilitarian, calm, Material Design 3 and Google Keep-inspired clarity. Note content takes precedence over chrome.
- **Tone**: Quiet, purposeful workspace; no advertising, upsells, or decorative clutter.
- **Accessibility**: High contrast standards (WCAG AA >= 4.5:1), keyboard-accessible modals with focus trapping, and respect for `prefers-reduced-motion`.

## Evidence on Hand

- Verified Vue 3 frontend (`web/src/`) with 98 automated Vitest unit/component behavior tests.
- Express runtime with complete Mocha integration test suite.
- Authoritative OpenAPI 3.0 specification (`docs/openapi.yaml`) and TypeScript domain definitions (`types/api.d.ts`).
- Production-tested Docker Compose stack with healthchecks and graceful shutdown.

## Product Principles

1. **Capture First**: The input bar is prominent and ready. Opening and composing notes takes zero unnecessary friction; autosave protects against data loss.
2. **Calm Hierarchy**: Chrome recedes into the background. Note cards are clear, comfortable, and tactile; color functions as an organizational aid rather than visual noise.
3. **True Data Sovereignty**: All data remains on the user's host machine. Full archive import and export guarantees zero vendor lock-in.
4. **Keyboard & Accessibility by Default**: First-class keyboard shortcuts (`/`, `Ctrl+K`, `Esc`), proper ARIA landmarks, focus rings, and WCAG AA contrast across all light and dark palettes.

## Accessibility & Inclusion

- WCAG AA contrast compliance across light and dark theme variations for all 12 note color swatches.
- Standard dialog focus management with `Esc` dismiss and backdrop traps.
- Semantic HTML landmarks (`header`, `main`, `section`, `nav`).
- Respects `prefers-reduced-motion` across all transitions and animations.
