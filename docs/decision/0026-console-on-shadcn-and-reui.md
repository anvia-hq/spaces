# 0026 — Console on shadcn/ui primitives and the free ReUI set

- **Status:** accepted (supersedes parts of 0023; ReUI and the token vocabulary superseded in part by 0039)
- **Date:** 2026-11-15

## Context

0023 built the console on a hand-rolled primitive kit: one `ui.tsx` with a button, panel, field, tabs,
segmented control, skeleton and terminal. It worked while the console was three screens. The API kept
growing, and every new capability asked for something the kit did not have — a select, a dialog, a
toast, a table that sorts and pages, a popover. Each one was a small accessibility project, and the
console started to look like the kit rather than like the product.

ReUI is a shadcn registry: components are installed as source into `components/`, on top of Base UI
primitives and Tailwind v4 tokens. Nothing is a runtime dependency, and every file can be edited.
The free tier covers the primitives this console needs; blocks (whole page layouts) are paid.

## Decision

**Install from the registry, own the source.** `apps/web/components.json` points the shadcn CLI at
`https://reui.io/r/{style}/{name}.json` with style `base-nova` (Base UI), and components land in
`components/reui` (ReUI) and `components/ui` (stock shadcn). No UI package is imported at runtime.

**Free set only.** Blocks sit behind `REUI_LICENSE_KEY` and would tie the repository to a paid account
for layout sugar. The free primitives — data grid, badge, alert, frame, timeline, tree, stepper, number
field — are the ones the console actually uses.

**One token vocabulary.** shadcn's names are the contract: `--background`, `--card`, `--popover`,
`--primary`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, `--destructive`, plus
ReUI's `--success`, `--warning`, `--info`, `--invert`, `--focus`. Values come from the existing warm
charcoal palette; the lime signal is `--primary`. The old `surface` / `ink` / `line` / `signal` names are
gone — `signal` in particular had to go, because shadcn already means "subtle hover surface" by `accent`,
and two meanings for one word is how a palette rots.

**Dark only, and honest about it.** `<html class="dark">` stays on, so the `dark:` variants inside
vendored components resolve to the same palette instead of silently disagreeing with the page.

**Shell: top bar, no sidebar.** Two destinations do not earn a rail, and 0023's reasoning still holds.
The lifecycle feed left the tab row: it is context, not a job, so it lives in the sandbox's aside as a
timeline next to the machine facts. Tabs are now only the things you do to a machine — Terminal, Files,
Ports, SSH, Snapshots, Usage.

**Destructive actions state the consequence.** 0023 chose inline arming partly because it is cheaper than
a modal, and noted the cost: it cannot say "this deletes the disk". Deleting a sandbox or a snapshot only
destroys a frozen disk, so the dialog states that, names the object, and needs a second, deliberate click.
Inline arming survives for the small stuff (kill a process, unpublish a port).

**Grid where the data is tabular, lists where it is not.** Sandboxes and saved snapshots are a TanStack
Table v9 data grid (sort, page, column visibility); files, ports, processes and share codes stay plain
lists, because they are scanned, not compared.

**Vendored code is not ours.** Two things must be re-applied after any registry install: ReUI items
declare a bogus npm dependency named `cn` (the CLI installs the real `cn` package and writes
`import { cn } from "cn"`), and `data-grid-cell-selection.tsx` needs a one-line narrowing fix under
`noUncheckedIndexedAccess`.

## Consequences

- The console gains ~50 transitive dependencies (Base UI, TanStack Table and Virtual, dnd-kit,
  headless-tree) and the main bundle is now past the 500 kB warning line. Code-splitting the grid and the
  file browser is the obvious next cut, not a redesign.
- Registry components arrive as source, so upgrades are manual diffs against the registry, not a version
  bump. That is the price of being able to fix a component's padding without forking a library.
- The `cn` rewrite and the narrowing fix are a per-install chore until ReUI corrects the manifest.
- The free tier means the layouts we would have copied from premium blocks are ours to maintain.
- Our own `.ts`/`.tsx` stay comment-free (0149 is a rule in `tooling/oxlint`, adopted here); vendored registry files
  keep the comments they shipped with, and are treated as third-party source.

## Alternatives ruled out

- **Extending the hand-rolled kit.** The last three additions each became a small a11y project, and the
  fourth (a sortable table) is a week, not an afternoon.
- **Buying blocks.** A license key in CI and a repository pinned to someone's paid tier, for layouts that
  are the least product-specific part of a console.
- **A styled component library as a dependency.** Faster to start, but the source cannot be edited, and
  the visual system becomes whatever the library ships.
- **Adding a sidebar.** Familiar, but it would carry two links, and a rail of two icons is a costume.
