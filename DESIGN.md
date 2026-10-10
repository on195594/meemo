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
  surface: "#f8fafd"
  on-surface: "#1f1f1f"
  on-surface-variant: "#3c4043"
  surface-container-low: "#f0f4f9"
  surface-container: "#ffffff"
  surface-container-high: "#e9eef6"
  outline: "#747775"
  outline-variant: "#c4c7c5"
  error: "#ba1a1a"
  error-container: "#ffdad6"
  note-coral: "#fbe8e7"
  note-peach: "#fef0d5"
  note-sand: "#fefad2"
  note-mint: "#e6f9d7"
  note-sage: "#dcf8f2"
  note-fog: "#e2f5f9"
  note-storm: "#e0ecfd"
  note-dusk: "#f1e6fd"
  note-blossom: "#fdebf3"
  note-clay: "#f5ece2"
  note-chalk: "#f1f3f4"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "2rem"
    fontWeight: 700
    lineHeight: 1.25
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: 1.4
rounded:
  none: "0px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  2xl: "28px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
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
    rounded: "{rounded.lg}"
    padding: "16px"
  search-pill:
    backgroundColor: "{colors.surface-container-high}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.xl}"
    padding: "10px 16px"
---

# Design System

## Overview

Meemo's visual design combines the tactile, effortless spatial organization of Google Keep with the refined structural hierarchy of Material Design 3 (M3). It is designed to feel like a responsive, private digital scratchpad that disappears during thought capture and cleanly surfaces structure during review.

Key attributes:
- **Card-centric canvas**: Notes are independent surfaces arranged on a responsive masonry canvas.
- **12-Tone Semantic Color System**: Calibrated pastels for light mode, rich muted earths for dark mode, all engineered for WCAG AA text contrast.
- **Tonal Elevation over Harsh Drop Shadows**: Surfaces differentiate through ambient light and tonal fills rather than heavy black drop shadows.
- **Keyboard-first Ergonomics**: Clear focus rings and persistent search navigation.

## Colors

Meemo relies on two complementary palettes: the Material 3 structural palette and the Google Keep 12-color note palette.

### Structural Surface & Accent Tokens
- `primary`: `#0b57d0` (Light) / `#a8c7fa` (Dark) — Google Standard Blue, used for primary actions, active tabs, and focused controls.
- `surface`: `#f8fafd` (Light) / `#121316` (Dark) — App canvas background.
- `surface-container`: `#ffffff` (Light) / `#1e1f20` (Dark) — Standard note card and dialog base.
- `surface-container-high`: `#e9eef6` (Light) / `#2b2d30` (Dark) — Search input pills, tag badges, and secondary buttons.
- `on-surface`: `#1f1f1f` (Light) / `#e3e3e3` (Dark) — High-contrast primary reading text (> 10:1 ratio).
- `on-surface-variant`: `#3c4043` (Light) / `#c4c7c5` (Dark) — Secondary text, timestamps, and icons (> 4.5:1 ratio).
- `outline-variant`: `#c4c7c5` (Light) / `#444746` (Dark) — Subtle card borders and divider rules.

### Google Keep 12-Color Note Palette
Every note color is calibrated as a background tone that preserves comfortable reading contrast with `--md-sys-color-on-surface`:
- Default: `#ffffff` (Dark: `#1e1f20`)
- Coral: `#fbe8e7` (Dark: `#3c2020`)
- Peach: `#fef0d5` (Dark: `#3d2c10`)
- Sand: `#fefad2` (Dark: `#3d3b10`)
- Mint: `#e6f9d7` (Dark: `#203614`)
- Sage: `#dcf8f2` (Dark: `#103330`)
- Fog: `#e2f5f9` (Dark: `#1a353c`)
- Storm: `#e0ecfd` (Dark: `#15273f`)
- Dusk: `#f1e6fd` (Dark: `#2d1a3e`)
- Blossom: `#fdebf3` (Dark: `#3c162c`)
- Clay: `#f5ece2` (Dark: `#2f2010`)
- Chalk: `#f1f3f4` (Dark: `#28292c`)

## Typography

Typography prioritizes system-native fonts (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`) for instantaneous render times and platform familiarity.

- **Display** (`2rem`, 700 weight): App branding and hero welcomes.
- **Headline** (`1.5rem`, 600 weight): Modal headers and workspace section titles (`Notes`, `Archive`, `Trash`).
- **Title** (`1.125rem`, 600 weight): Note card titles.
- **Body** (`0.9375rem`, 400 weight, `1.55` line height): Note card body copy, modal editor text, markdown prose.
- **Label** (`0.8125rem`, 500 weight): Tag chips, timestamp metadata, keyboard shortcuts.
- **Code / Monospace** (`0.875rem`, font-family: monospace): Markdown code spans and fenced blocks.

## Layout

- **Header Bar**: Sticky navigation bar with responsive width constraint (`is-wide` mode toggle), central pill search input, and right-aligned theme toggle and account controls.
- **Masonry Grid**: Multi-column masonry layout (`column-count` responsive breakpoints: 1 column on mobile `< 600px`, 2 columns at `600px-1024px`, 3-4 columns on desktop `> 1024px`).
- **Stream Composer**: Centered top composer that starts as a single-line prompt and expands smoothly on focus into a full Markdown drafting card.
- **Modal Layer**: Centered floating dialog (`max-width: 680px` for note details, `max-width: 480px` for dialogs) with smooth backdrop blur.

## Elevation & Depth

Meemo uses M3 tonal elevation layers:
- `elevation-0`: Flat borders (`border: 1px solid var(--note-border-color)`).
- `elevation-1`: Subtle resting card depth (`0 1px 3px 0 rgba(60,64,67,0.15), 0 1px 2px 0 rgba(60,64,67,0.08)`).
- `elevation-2`: Hovered note cards, sticky pinned cards, and dropdown menus (`0 2px 6px 2px rgba(60,64,67,0.15)`).
- `elevation-3`: Floating modals and detail view dialogs (`0 4px 8px 3px rgba(60,64,67,0.15)`).

## Shapes

Corner radii adhere to the M3 shape hierarchy:
- `xs` (4px): Inline code badges, progress bars.
- `sm` (8px): Tag chips, action buttons, filter badges.
- `md` (12px): Image attachments, dropdown menus.
- `lg` (16px): Note cards and expanded note composer.
- `xl` (24px): Search input bar pill.
- `2xl` (28px): Modals and confirmation dialogs.
- `full` (9999px): Circular icon buttons, color picker swatches, user avatar.

## Components

### Note Card
- Card surface tinted with the note's selected background tone.
- Hover reveal for quick action buttons (Pin, Color, Archive, Delete).
- Pinned cards use subtle elevation depth (`elevation-2`) and primary border tint without thick side tabs.
- Checkboxes in markdown task lists styled with rounded corners and smooth tick transitions.

### Search Pill
- Centered in header, full-width on mobile.
- Shows `/` shortcut hint when inactive, clear `×` button when populated.
- Retains query state across navigation.

### Tag Chip
- Pill shape with `#` prefix.
- Click to filter stream by tag.
- Active tag filter shown in persistent summary banner with single-click dismiss.

### Color Picker
- 12 circular swatches in a grid popover.
- Visual checkmark or focus ring on the active selection.

## Do's and Don'ts

### Do
- Use CSS custom property tokens (`var(--md-sys-color-*)`, `var(--note-color-*)`) for all colors and background fills.
- Use `scaleX()` and GPU transforms for progress animations to prevent layout recalculations.
- Ensure all text against custom note colors meets WCAG AA contrast (>= 4.5:1).
- Keep interactive controls accessible via keyboard (`tabindex`, focus rings, `aria-label`).
- Respect `prefers-reduced-motion` settings.

### Don't
- Don't use heavy, asymmetrical colored left-border side-tabs (`border-left: 4px solid ...`) on cards; use tonal accents, badges, or uniform borders.
- Don't hardcode light hex colors in modals or components without dark mode tokens.
- Don't animate layout properties (`width`, `height`, `padding`, `margin`) directly when transform/opacity can achieve the effect.
- Don't trap focus without providing `Escape` dismiss handling.
