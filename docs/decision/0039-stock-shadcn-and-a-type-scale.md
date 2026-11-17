# 0039 — Stock shadcn/ui, no ReUI, and a real type scale

- **Status:** accepted (supersedes 0026's ReUI and token-vocabulary parts)
- **Date:** 2026-11-17

## Context

0026 installed the free ReUI set into `components/reui`, so the console's frames, badges, alerts, data
grid, timeline and file icons were third-party source with local patches: a bogus `cn` manifest
dependency, a narrowing fix, and a 2,400-line cell-selection file that existed only for spreadsheet
behaviour the console never used. Its data grid pulled in dnd-kit, headless-tree and TanStack Virtual,
and the screens that used it (sandboxes, traces, audit) only sort and page.

Separately, `styles.css` collapsed every text token to 14px as a placeholder "until each element is
decided". Titles, labels and body copy had one size, so a page had no entry point.

## Decision

**Stock shadcn only.** `components.json` has no registries. `components/ui` holds the shadcn CLI's output
(`alert`, `table` added alongside the existing set), and nothing lives in `components/reui`. Console
composites are built on those primitives: `components/console/data-table.tsx` is one TanStack Table v8
table (sort, page, row click) on shadcn `Table`, replacing the three grid compositions. Frames become
`Card`; reui badge variants become stock `Badge` variants with the semantic tones from
`console/tone.ts`; the timeline becomes an ordered list; file-type icons become lucide `File`/`Folder`.

**A type scale.** 14px (`text-base`) stays the reading size. `text-xs`/`2xs` carry metadata and group
labels, `text-lg` and up carry headings. Page titles are `text-xl`. Nothing else changes size, so body
copy keeps its look.

**Shell as a sidebar with a workspace header.** The desktop rail and the mobile sheet render the same
`SidebarContent`: a workspace header, grouped navigation with icons, and an account card. Page titles carry
an icon from the nav, and KPI tiles share `console/kpi-card.tsx`. The reference this follows has quick
actions and a `K` shortcut too; the console has no command palette yet, so those are not built.

## Consequences

- Dependencies lost: `@dnd-kit/*`, `@headless-tree/core`, `@tanstack/react-virtual`, `cn`. TanStack Table
  moves from v9 to v8, the version shadcn's data-table recipe targets.
- The grid is not virtualised and has no column visibility or drag reordering. Pages are 12 to 25 rows,
  so neither is needed yet; revisit if a list grows past a few hundred rows.
- Updating a shadcn component is a CLI re-add, which may overwrite local edits. Edit `components/console`
  instead of `components/ui` when a change is specific to the console.
- Vendored `ui/` files keep their shipped comments; our `.ts`/`.tsx` stay comment-free.

## Alternatives ruled out

- **Keep ReUI and patch it.** Every registry update was a manual diff, and the parts the console needed
  were a fraction of what was vendored.
- **Keep the single size.** It was marked temporary, and it flattened every heading into body copy.
