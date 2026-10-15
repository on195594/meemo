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
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif"
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

Meemo's visual design combines the tactile, effortless spatial organization of Google Keep with the refined structural hierarchy of Material Design 3 (M3). It is designed to feel like a responsive, private digital scratchpad that disappears during thought capture and cleanly surfaces structure during review.

Key attributes:
- **Card-centric canvas**: Notes are independent surfaces arranged on a responsive masonry canvas.
- **12-Tone Keep Color System**: Google Keep's current note palette in light and dark, used as organizational fills behind default text color.
- **Quiet Chrome**: 1px outlines at rest, a soft two-layer shadow on hover; card controls appear only on hover or focus.
- **Keyboard-first Ergonomics**: Clear focus rings and persistent search navigation.

## Colors

Meemo relies on two complementary palettes: the Material 3 structural palette and the Google Keep 12-color note palette. Color tokens are explicitly declared for light mode and dark mode (`:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)`) for universal browser compatibility. When a custom background image is active, an ambient canvas tint (`.has-custom-bg`) provides contrast protection to ensure WCAG AA/AAA readability.

### Structural Surface & Accent Tokens
- `primary`: `#0b57d0` (Light) / `#a8c7fa` (Dark) — Links, focus rings, primary auth buttons, avatar.
- `keep-accent`: `#fbbc04` — Snackbar action text (Undo). Not used for focus rings: it is below 3:1 on white.
- `keep-nav-active`: `#feefc3` (Light) / `#41331c` (Dark) — Active sidebar item pill.
- `keep-snackbar`: `#323232` (Light) / `#e8eaed` (Dark) — Snackbar surface.
- `surface`: `#ffffff` (Light) / `#202124` (Dark) — App canvas background.
- `surface-container`: `#ffffff` (Light) / `#202124` (Dark) — Default note card and dialog base.
- `surface-container-high`: `#f1f3f4` (Light) / `#525355` (Dark) — Resting search box.
- `on-surface`: `#202124` (Light) / `#e8eaed` (Dark) — Primary reading text.
- `on-surface-variant`: `#5f6368` (Light) / `#9aa0a6` (Dark) — Icons, placeholders, section labels. On colored notes it is overridden to `on-surface` at 87% (min 4.6:1 across all Keep fills), because the gray drops below 4.5:1 on fills like dark Fog and light Peach.
- `outline-variant` / `note-border-color`: `#e0e0e0` (Light) / `#5f6368` (Dark) — Default-card outline and header divider. Colored cards drop the outline.

### Google Keep 12-Color Note Palette
Note colors are background fills read with `--md-sys-color-on-surface` (dark text in light mode, light text in dark mode):
- Default: `#ffffff` (Dark: `#202124`)
- Coral: `#faafa8` (Dark: `#77172e`)
- Peach: `#f39f76` (Dark: `#692b17`)
- Sand: `#fff8b8` (Dark: `#7c4a03`)
- Mint: `#e2f6d3` (Dark: `#264d3b`)
- Sage: `#b4ddd3` (Dark: `#0c625d`)
- Fog: `#d4e4ed` (Dark: `#256377`)
- Storm: `#aeccdc` (Dark: `#284255`)
- Dusk: `#d3bfdb` (Dark: `#472e5b`)
- Blossom: `#f6e2dd` (Dark: `#6c394f`)
- Clay: `#e9e3d4` (Dark: `#4b443a`)
- Chalk: `#efeff1` (Dark: `#232427`)

## Typography

System font stack (`--md-sys-typescale-font`) throughout; code uses `--md-sys-typescale-font-mono`. Font sizes come from the M3 type scale tokens in `web/src/styles/tokens.css` (`--md-sys-typescale-{display,headline,title,body,label}-{large,medium,small}`).

## Layout

- **Header Bar**: Full-width, 64px, 1px bottom divider. Hamburger, logo, search box (max 720px, 8px radius, turns white with shadow on focus), grid/list toggle, theme toggle (icon only), avatar.
- **Sidebar**: Notes, Archive, Trash. Desktop: 80px icon rail that peeks open on hover, or 280px when expanded via the hamburger (remembered per browser). Below 768px: overlay drawer with scrim; focus moves into it, Tab stays inside, and Escape or a scrim click closes it and returns focus to the menu button. Navigation writes the existing `tag` / `archived` / `deleted` route query.
- **Masonry Grid**: Row-order (left-to-right) columns of fixed 240px cards with 16px gaps, centered. When the stream itself is narrower than 600px (phones, or a narrow window with the sidebar expanded) columns become flexible with a 160px minimum and 8px gaps — two columns on a typical phone. Items are dealt round-robin (`web/src/utils/masonry.ts`), so column heights can differ. List view is a single 600px column.
- **Composer**: 600px, centered. Collapsed: "Take a note…" with New list and image shortcuts. Expanded: Title, auto-growing body, toolbar, and a `Close` text button. Close, Escape or a click outside saves a non-empty draft; a failed save keeps the draft open. It stays mounted (hidden) in Archive/Trash so a draft survives view switches.
- **Modal Layer**: Note dialog `min(600px, 100%)` (full screen below 600px); auth/import 440-480px, cheatsheet 540px.
- **Snackbar**: Bottom-left, 4px radius, auto-dismisses (6s with Undo, 3s otherwise). Archive and Trash actions offer Undo.

## Elevation & Depth

- Resting cards: no shadow, 1px outline (default color only).
- `--keep-shadow-hover`: hovered or focused cards, focused search box.
- `--keep-shadow-raised`: composer, color popovers, peeking sidebar rail.
- `--keep-shadow-dialog`: note dialog and mobile drawer.

The older `--md-sys-elevation-*` tokens remain for auth, settings, and import dialogs.

## Shapes

- `--keep-card-radius` (8px): Note cards, composer, note dialog, search box, color popovers.
- `xs` (4px): Snackbar, text buttons (`Close`), code blocks.
- `full` (9999px): Icon buttons, label chips, color swatches, avatar, sidebar active pill (right side only).
- `2xl` (28px): Remaining M3 dialogs (auth, settings, import).

## Components

### Note Card
- Card surface tinted with the note's color; colored cards drop the outline. Hovering/focusing cards dissolves the outline into a subtle elevation shadow.
- A leading `# Heading` renders as the title (16px/500); internal Markdown headings follow a clear hierarchy (h2: 15px, h3+: 14px); body text is 14px. Clickable stream cards clip at 400px with a cross-browser fade mask. Text selection on cards does not trigger modal navigation.
- Image attachments sit edge-to-edge at the top; other attachments are compact badge chips.
- Hover/focus reveals the pin (top-right), the selection check (top-left, outside the corner), and the toolbar (color, More). Archive/unarchive, make a copy, public/private and Delete note live in More, keeping the card toolbar minimal and reducing accidental taps. Pinned notes retain their pin at rest. On touch devices the toolbar and pin are always visible, and long-press initiates multi-select mode.
- No timestamp on editable cards; read-only views (shared/public) show it in the footer.
- Checklist items toggle in place with enlarged touch hit targets; clicking anywhere else, or Enter on the focused card, opens the dialog.

### Note Dialog
- Opens ready to edit: Title input and auto-growing body textarea (Markdown source). No preview toggle.
- Footer: color, More on the left; `Close` on the right. Archive/unarchive, make a copy, public/private and Delete note live in More. Close, Escape or a backdrop click saves with revision checks and stays open if the save fails. Escape inside a color or More popup closes only that popup, restores its trigger focus, and does not save the draft.
- Read-only notes (Trash, public stream) render Markdown instead of the editor.

### Action Menus & Color Popovers
- Make a copy creates a private, unpinned, unarchived note in Notes, retaining content, color and attachment references. In the detail dialog it copies the current draft without saving or closing the original; failures keep the draft and allow retry. Copy actions for the same note are disabled while pending.
- Note More and account options share `ActionMenu.vue`: menu roles, initial focus, Up/Down wrapping, Home/End, first-letter navigation, Escape focus restoration, and native Tab traversal. Clicking or focusing outside dismisses without stealing focus.
- Menus and all three color palettes use shared viewport-clamped positioning: flip above when needed, track scrolling/resizing, and stay inside an 8px viewport gutter.
- `--keep-control-size`: 40px icon/swatch hit areas, 44px on coarse pointers; swatches retain a 28px color circle. Card titles reserve pin space without narrowing the note body.

### Search Box
- Shows the `/` shortcut hint when empty, a clear `×` when populated; results show a "Results for …" line with Clear search.

### Label Chips
- Inline `#tags` render as small rounded chips inside the card body and filter the stream on click. The sidebar lists the same labels.

### Color Picker
- 12 circular swatches in a 4-column popover below the trigger; the Default swatch has a ring.
- Active swatch exposed with `aria-pressed`; arrow keys, Home/End and Escape supported.

### Snackbar
- Dark surface with an accent-colored `Undo` and a dismiss button; `role="status"`.

## Do's and Don'ts

### Do
- Use CSS custom property tokens (`var(--md-sys-color-*)`, `var(--note-color-*)`) for all colors and background fills.
- Use `scaleX()` and GPU transforms for progress animations to prevent layout recalculations.
- Ensure all text against custom note colors meets WCAG AA contrast (>= 4.5:1).
- Keep interactive controls accessible via keyboard (`tabindex`, focus rings, `aria-label`).
- Respect `prefers-reduced-motion` settings.

### Don't
- Don't use heavy, asymmetrical colored left-border side-tabs (`border-left: 4px solid ...`) on cards; use tonal fills or uniform borders.
- Don't show card controls at rest on hover-capable devices; reveal them on hover or focus.
- Don't use emoji as icons; use `UiIcon`.
- Don't hardcode light hex colors in modals or components without dark mode tokens.
- Don't animate layout properties (`width`, `height`, `padding`, `margin`) directly when transform/opacity can achieve the effect.
- Don't trap focus without providing `Escape` dismiss handling.
