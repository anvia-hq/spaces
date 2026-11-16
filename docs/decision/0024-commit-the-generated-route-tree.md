# 0024 — Commit the generated route tree

- **Status:** accepted
- **Date:** 2026-11-15

## Context

TanStack Router generates `apps/web/src/routeTree.gen.ts` from the file-based routes, and `main.tsx`
imports it. That file was gitignored as a build artefact.

Verified consequence on a fresh clone: `bun run typecheck` fails with

```
src/main.tsx(4,27): error TS2307: Cannot find module './routeTree.gen.ts'
src/routes/index.tsx(21,38): error TS2345: Argument of type '"/"' is not assignable…
```

until someone has run `vite dev` or `vite build` once. The first command a contributor runs is usually
the one that fails.

## Decision

Commit `apps/web/src/routeTree.gen.ts`. Keep the router plugin as the source of truth — it regenerates
the file whenever routes change.

## Consequences

- `bun run typecheck` and `bun run build` work immediately after clone.
- The file appears in diffs when routes change. It is generated and mechanical, so the noise is small and
  it is an honest signal that routing changed.
- A merge conflict in it is resolved by regenerating, not by hand.

## Alternatives considered

- **Keep ignoring it and document "run dev once".** Rejected: a documented workaround for a first-run
  failure is worse than a generated file in the tree.
- **Generate it in a `prepare`/`pretypecheck` script.** Better in principle; adds a build step to
  typechecking and needs the plugin's CLI, which is not currently a dependency.
