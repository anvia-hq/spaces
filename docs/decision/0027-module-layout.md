# 0027 — Feature code in modules, on both sides

- **Status:** accepted
- **Date:** 2026-11-16

## Context

The API was a single `app.ts` of 1725 lines (middleware, every route, the error map, the console
mount) over a single `service.ts` of 1832 lines (sandboxes, files, commands, snapshots, usage, ports,
SSH). The console had one `ui.tsx` holding nine components plus four re-exports, and six panels living
in `components/` where feature code and feature-agnostic primitives looked identical.

That is fine while there are three screens and forty endpoints. It stops being fine when the next
change touches authentication and API keys: every route, every service function and every screen is a
needle in the same haystack, and nothing in the tree says which pieces belong together.

The Aven repositories already answer this question. `apps/control-plane` groups by module
(`router.ts`/`schema.ts`/`service.ts`, typed errors in one file, infra singletons outside), and
`apps/platform` layers `routes -> components -> hooks` with `src/lib/` and `src/components/` for what
is not feature code. Reading a change there is a matter of opening one folder.

## Decision

**Adopt that layout in spaces, with no behaviour change, in one pass.**

API (`apps/api/src`): one folder per domain concept in `modules/` — `sandboxes`, `commands`, `files`,
`snapshots`, `transfers`, `ports`, `ssh`, `usage`, `system`, and `driver` for the seam. Each has
`router.ts` (routes only), `schema.ts` (zod), `service.ts` (logic and DB) and `types.ts` when it has
exported types; helpers are named for what they do. Typed errors and their HTTP mapping moved to
`src/errors.ts`. `config.ts` and `db.ts` stay outside modules, and `app.ts` shrank to wiring:
middleware, the routers, `onError`, the console mount, the not-found envelope.

Web (`apps/web/src`): pages stay in `routes/` and get thin; feature code moved into
`modules/<name>/{components,hooks,types.ts}`; `ui.tsx` was split into one component per file under
`components/console/`; the barrel re-exports (`usePoll`, `timeAgo`, `fmtBytes`, `fmtDuration`) were
removed so callers import `@/lib/*` directly.

`packages/shared/src/index.ts` was a pure re-export, so it is gone; the package now exposes
`@spaces/shared/{sandbox,files,errors}`.

## Consequences

- Two delegated files (`app.ts`, `service.ts`) became ~40 focused ones. The declared route table is
  unchanged: 74 method+path pairs before and after, diffed mechanically, and the contract tests pass
  untouched.
- Adding a screen or an endpoint now starts by creating a folder. The cost is more files and more
  relative imports inside a module; the payoff is that a diff names its area.
- A few rules were kept deliberately gentle. `lib/api.ts` remains the typed client and keeps the
  wire response types (Aven's `lib/api.ts` is untyped and each module types its own answers): moving
  them would invert the layering or duplicate thirty endpoint shapes. `packages/db/src/index.ts`
  survives as a package entry because it owns `createDb`, not because it re-exports.
- `bun test` from the repo root still bypasses `apps/api/bunfig.toml`; that is pre-existing and now
  documented in `AGENTS.md`.
- Comments were kept where they were. Removing them is a separate change with its own review cost,
  and it would have hidden the moves in this one.

## Alternatives

- **Leave it and wait.** The refactor earns nothing today; it earns the next feature, which is
  authentication on both sides.
- **Split only the API.** The console is where the panels sit side by side with shared primitives; a
  one-sided move would have kept the confusion that mattered most.
- **Adopt Aven's stricter rules too** (Elysia, comments forbidden, `@aven/ui` as a package). That
  changes behaviour or needs new dependencies, so it is out of scope for a layout change.
