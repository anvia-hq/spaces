# 0040 — Color and theme follow the Anvia design system

- **Status:** accepted
- **Date:** 2026-11-17

## Context

The console had one dark theme on a warm charcoal base, with lime as its only accent. The Anvia product
system (`anvia-hq/anvia-product-system`, `design-system.md`) sets the company's visual contract for
the website and product previews: Zinc as the only UI neutral, hue reserved for meaning, and two
themes with dark as the first-visit default.

## Decision

**Zinc primitives, semantic tokens, shadcn aliases.** `styles.css` defines the Zinc scale and the
`--ops-*` semantic layer per theme in one block. The shadcn names (`--background`, `--primary`,
`--border`, …) alias the `--ops-*` tokens, so components keep their class names and nothing outside that
block names a raw color. Status, chart and destructive hues come from the system's named values
(`#4fc77a`, `#db5b5b`, `#d8a640`, `#5b8def`), with light-theme ink variants for readable text.

**Two themes, dark first.** `lib/theme.ts` stores the choice under `anvia-theme` in `localStorage`.
The default is dark and the OS preference is never read. An inline script in `index.html` applies the
theme before the first paint, and `data-theme`, `.dark`, `color-scheme`, `theme-color` and the favicon
stay in step with it. The `D` key toggles the theme (`lib/use-theme-shortcut.ts`) and is ignored in
editable fields and on modified keys. The sidebar shows a non-interactive `D theme` hint, not a button.

**Transparent neutral hovers.** Hover changes text color, not the background. Active and selected states
use the Zinc surface tokens (`accent`, `secondary`). Primary actions keep their inverted fill. Overlays
use `--ops-scrim` rather than a raw black.

**Favicons per theme.** `favicon.svg` is the light mark on dark, `favicon-light.svg` the dark mark on
light.

## Consequences

- The console's lime accent is gone; primary actions are now the inverted ink/paper pair.
- Keyboard-highlighted menu items keep a Zinc highlight (`focus:bg-accent`). That is a selection state,
  not a hover, so the system's hover rule does not cover it.
- The console has no syntax-highlighted code view yet, so the preserved syntax palettes are not
  imported. A code view must use them unchanged.
- The system's typography (Google Fonts, variable weights) is not adopted here; the console keeps the
  system stack, which is a separate decision.

## Alternatives ruled out

- **Keep the charcoal palette and add a light theme.** Two palettes that differ in hue would not read as
  one product, and the reference is explicit about Zinc as the only neutral.
- **Follow `prefers-color-scheme`.** The system requires an explicit, persisted choice with dark as the
  default.
