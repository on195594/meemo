---
name: Meemo Design System
description: Material Design 3 and Google Keep inspired visual system for Meemo
colors:
  primary: "#0b57d0"
  on-primary: "#ffffff"
  primary-container: "#d3e3fd"
  on-primary-container: "#041e49"
  secondary: "#535f70"
  on-secondary: "#ffffff"
  surface: "#ffffff"
  on-surface: "#202124"
  on-surface-variant: "#5f6368"
  surface-container-low: "#f1f3f4"
  surface-container: "#ffffff"
  surface-container-high: "#f1f3f4"
  outline: "#747775"
  outline-variant: "#e0e0e0"
  error: "#ba1a1a"
  error-container: "#ffdad6"
  keep-accent: "#fbbc04"
  keep-nav-active: "#feefc3"
  keep-snackbar: "#323232"
  note-coral: "#faafa8"
  note-peach: "#f39f76"
  note-sand: "#fff8b8"
  note-mint: "#e2f6d3"
  note-sage: "#b4ddd3"
  note-fog: "#d4e4ed"
  note-storm: "#aeccdc"
  note-dusk: "#d3bfdb"
  note-blossom: "#f6e2dd"
  note-clay: "#e9e3d4"
  note-chalk: "#efeff1"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans SC', sans-serif"
    fontWeight: 400
rounded:
  none: "0px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "28px"
  full: "9999px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  note-card:
    backgroundColor: "{colors.surface-container}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  search-pill:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.sm}"
    padding: "0 4px"
---

# Design System

## Overview

Meemo pairs Material Design 3 structural tokens with a Google Keep-inspired spatial note canvas: independent note cards in a responsive masonry layout, the 12-tone Keep color palette, 1px resting outlines with soft hover shadows, and keyboard-first focus/search ergonomics.

## Colors

Light and dark themes are declared on `:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`. Custom background images apply `.has-custom-bg` canvas tinting for readable contrast.

### Structural tokens
- `primary`: `#0b57d0` (Light) / `#a8c7fa` (Dark) — Links, focus rings, primary buttons, avatar.
- `keep-accent`: `#fbbc04` — Snackbar Undo label (not used for focus rings; below 3:1 on white).
- `keep-nav-active`: `#feefc3` (Light) / `#41331c` (Dark) — Active sidebar pill.
- `keep-snackbar`: `#323232` (Light) / `#e8eaed` (Dark) — Snackbar surface.
- `surface` / `surface-container`: `#ffffff` (Light) / `#202124` (Dark) — App canvas, default cards, dialogs.
- `surface-container-high`: `#f1f3f4` (Light) / `#525355` (Dark) — Search box.
- `on-surface`: `#202124` (Light) / `#e8eaed` (Dark) — Primary reading text.
- `on-surface-variant`: `#5f6368` (Light) / `#9aa0a6` (Dark) — Secondary labels/icons; overridden on colored notes to 87% `on-surface` (min 4.6:1 contrast across all Keep fills).
- `outline-variant` / `note-border-color`: `#e0e0e0` (Light) / `#5f6368` (Dark) — Default-card border and dividers (omitted on colored cards).

### 12-Color Note Palette
Note fills are read with `--md-sys-color-on-surface` (Light / Dark hexes):
Default (`#ffffff` / `#202124`), Coral (`#faafa8` / `#77172e`), Peach (`#f39f76` / `#692b17`), Sand (`#fff8b8` / `#7c4a03`), Mint (`#e2f6d3` / `#264d3b`), Sage (`#b4ddd3` / `#0c625d`), Fog (`#d4e4ed` / `#256377`), Storm (`#aeccdc` / `#284255`), Dusk (`#d3bfdb` / `#472e5b`), Blossom (`#f6e2dd` / `#6c394f`), Clay (`#e9e3d4` / `#4b443a`), Chalk (`#efeff1` / `#232427`).

## Typography

Multilingual system/CJK sans stack (`--md-sys-typescale-font`), monospace code (`--md-sys-typescale-font-mono`), and M3 type scale tokens in `web/src/styles/tokens.css`.

## Layout

- **Header bar**: 64px full width, 1px bottom divider, hamburger, logo, search box (max 720px, 8px radius, focus shadow), grid/list toggle, theme toggle, avatar.
- **Sidebar**: Notes, Archive, Trash (`tag` / `archived` / `deleted` route queries). Desktop: 80px icon rail (hover peek) or remembered 280px expanded sidebar; `< 768px`: modal overlay drawer with focus trap and Escape/scrim dismissal.
- **Masonry grid**: Fixed 240px cards with 16px gaps (switching to flexible `>= 160px` columns / 8px gaps when stream `< 600px`), placing items into the shortest column from bounded height estimates (`web/src/utils/masonry.ts`); ties break left-to-right. List view uses a 600px single column.
- **Composer**: 600px centered; collapsed quick actions or expanded title/body/toolbar; saves non-empty drafts on Close/Escape/outside click (retains draft on error and across tab switches).
- **Modals & snackbar**: Note dialog `min(600px, 100%)` (full screen `< 600px`), auth/import 440–480px, settings 500px, cheatsheet 540px. Bottom-left snackbar auto-dismisses (6s with Undo, 3s otherwise).

## Elevation & shapes

- **Elevation**: Resting default cards use a 1px outline; `--keep-shadow-hover` lifts hovered/focused cards (`translateY(-2px)`) and focused search; `--keep-shadow-raised` for composer/popovers/peeking rail; `--keep-shadow-dialog` for note dialog and mobile drawer; `--md-sys-elevation-*` for auth, settings, and import dialogs.
- **Shapes**: `--keep-card-radius` (`8px`) for cards, composer, note dialog, search, popovers; `4px` (`xs`) for snackbar, text buttons, code blocks; `9999px` (`full`) for icon buttons, chips, swatches, avatars, active sidebar pills; `28px` (`2xl`) for auth/settings/import/cheatsheet modals.

## Components

- **Note Card**: Edge-to-edge top image banners, file chips, inline `#tag` filter chips, checklists toggleable in place, title (`# Heading`, 16px/500) reserving pin space, 400px CSS body fade clip, hover/focus pin + selection check + color/More toolbar (always visible on touch devices; long-press starts multi-select). Timestamps show on read-only cards (Trash, shared, public).
- **Note Dialog**: Opens directly in Markdown editor mode (read-only rendered view for Trash/public). Close, Escape, or backdrop click saves with CAS; Escape inside open color/More popovers closes only that popover and restores trigger focus.
- **Action Menus & Popovers**: Shared `ActionMenu.vue` (WAI-ARIA menu keyboard nav + focus restoration) and `usePopoverPosition.ts` (viewport-clamped positioning tracking scroll/resize); 40px/44px touch targets with 28px color circles; active swatch marked `aria-pressed`.

## Do's and Don'ts

### Do
- Use CSS token variables (`var(--md-sys-color-*)`, `var(--note-color-*)`) across components and modals.
- Animate with transform/opacity (`scaleX`) and respect `prefers-reduced-motion`.
- Maintain WCAG AA text contrast (`>= 4.5:1`), `UiIcon` vectors, keyboard accessibility, and Escape dismissal on overlays.

### Don't
- Don't use asymmetrical colored left borders (`border-left: 4px`) on cards or hardcode un-tokenized light colors.
- Don't expose card action controls at rest on hover-capable devices or use emoji as UI icons.
- Don't trap keyboard focus without Escape handling.
