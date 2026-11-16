# 0004 — One monorepo, Bun workspaces, shared Zod contracts

- **Status:** accepted
- **Date:** 2026-11-15

## Context

The API and the console agree on about forty shapes (sandbox, snapshot, file entry, command record,
error envelope). Splitting them into separate repositories makes every contract change a two-repo
dance and lets them drift.

## Decision

A single repository with Bun workspaces:

```
apps/api      Hono on Bun
apps/web      React + Vite + TanStack Router + Tailwind
packages/shared   Zod schemas, error codes, machine sizes — imported by BOTH
packages/db       Drizzle schema, migrations, bun:sqlite client
```

The server needs no build step (Bun runs TypeScript directly); the console is the only build artefact.

## Consequences

- One `zod` schema validates the request on the server and types the same payload in the browser. A
  field renamed in `packages/shared` fails the build in both places at once.
- `bun run typecheck` and `bun run build` at the root cover everything (verified: four workspaces).
- Contributors need exactly one toolchain.
- Coupling: the web app cannot be extracted without first extracting `packages/shared`. Accepted —
  nothing suggests that split is coming.

## Alternatives considered

- **Separate repos with a published client package.** Rejected: versioning overhead for a codebase
  with one consumer.
- **Duplicate the types in the web app.** Rejected: the whole point is that they cannot drift.
