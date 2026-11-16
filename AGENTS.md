# AGENTS.md

Constraints and working style for agents and contributors. Why the code is shaped this way is in
`docs/decision/`.

## Overview

Bun workspace monorepo (TypeScript, ESM). The API and the console are the product; the guest image
lives in `deploy/guest`.

```
apps/api/     Hono API, the REST surface, one module per feature
apps/web/     React console (Vite, TanStack Router, Base UI, shadcn + ReUI)
packages/db/  Drizzle + Postgres, migrations in drizzle/
packages/shared/  the wire: zod request/response schemas, no imports but zod
docs/         decisions and the endpoint reference
deploy/       the unit file, the env template, the guest Dockerfile
scripts/      deploy and install helpers
```

## Commands

Run from the repo root.

```sh
bun install                 # install every workspace
bun run dev                 # API on :8787 and the console on :5173
bun run typecheck           # tsc across all workspaces; must pass before committing
bun run lint                # oxlint, aven's rules (lint:fix to autofix)
bun run format              # oxfmt (format:check to verify only)
bun run test:rules          # the oxlint plugin's own tests
bun run build               # builds the console into apps/web/dist (and regenerates routeTree.gen.ts)
bun run test                # apps/api tests (mock driver; the guest ones skip unless SPACES_IT=1)
bun run --cwd apps/api auth:schema   # regenerate the Better Auth tables after changing the plugin set
bun run test:guest          # the opt-in tests that need a real microVM
bun run db:migrate-from-sqlite <db>   # one-way move out of a SQLite deployment
SPACES_DATABASE_URL=... bun run --cwd packages/db generate   # drizzle-kit generate after a schema change
```

`bun test` from the repo root does **not** pick up `apps/api/bunfig.toml`, so its preload never runs
and every request is rejected. Use `bun run test`.

## Constraints

- **Bun only.** `bun`/`bunx`, never npm, yarn or pnpm, and no other lockfiles.
- **TypeScript strict.** No `any`; no comments in `.ts`/`.tsx` — names, types and tests say what code
  does, `docs/decision/` says why. Docs, CSS and shell keep their comments.
- **No barrel files.** An `index.ts` that only re-exports is forbidden; import from the exact file.
  `packages/shared` is imported by subpath (`@spaces/shared/sandbox`, `/files`, `/errors`).
- **oxlint and oxfmt gate every pull request** (`.github/workflows/ci.yml`). The rules are aven's, via
  `tooling/oxlint/` — fix the code, do not edit a rule to make a violation disappear unless the rule is
  wrong for both repos, and then port the fix to aven too. `docs/decision/0029` lists the three aven
  rules not enabled here and why.
- **Types live in `types.ts`.** Every exported `type`/`interface` belongs to its module's `types.ts`,
  imported with `import type`. Component `Props` and zod-inferred types stay beside their code.
- **Never edit generated files:** `apps/web/src/routeTree.gen.ts` and anything in
  `packages/db/drizzle/` (generate migrations, do not write them).
- **Postgres, not SQLite.** `SPACES_DATABASE_URL` is the only storage configuration; the store is
  async because the driver is (decision 0030). A service that reads the store must await it, and a
  router that calls a service must await that too — TypeScript will not catch a missing `await` on a
  value that is only serialised, so tests are the gate for that class of mistake.
- **Dependencies** go in the workspace that uses them, not the root.
- **No behaviour change without a decision.** `docs/api.md` is the contract; a new route, field or
  status code is a `docs/decision/` entry, not a quiet change.

## By area

### apps/api — Hono, zod, `@spaces/db`

Feature code is grouped by module in `src/modules/<name>/` (kebab-case):

```
router.ts    a Hono instance: routes, method-chained, validating with schema.ts and calling service.ts
schema.ts    zod request shapes (params, body, query)
service.ts   business logic and database access; knows nothing about HTTP
types.ts     exported types shared inside the module
```

- `router.ts` never touches `db` and never does work a service could own. `service.ts` returns data
  or throws a typed error from `src/errors.ts` (`ServiceError`, `DriverFailure`, `DriverUnsupported`);
  `src/errors.ts` maps them onto the shared error envelope and status codes in one place.
- A module may add helper files named for what they do (`commands/streams.ts`,
  `sandboxes/host-ports.ts`, `ports/preview.ts`). A second router is still routes only
  (`sandboxes/refusals.ts`, `snapshots/saved-snapshots.ts`).
- Infra singletons stay outside modules: `config.ts`, `db.ts` (the `store`), `errors.ts`, `auth.ts`
  (the bearer check), `json-body.ts` (empty body means `{}`), `origin.ts`, `console.ts` (serving the
  built console). `app.ts` only mounts middleware and routers.
- Modules are mounted with `app.route(prefix, router)`, so a router's paths are relative to
  `/api/v1`. The exception is `system`, mounted at `/`, which owns `/health` and `/api/v1/limits`.
- The driver seam is a module (`modules/driver/`): the `SandboxDriver` interface in `types.ts`, the
  singleton in `service.ts`, and one file per implementation (`microsandbox`, `mock`, `ssh` transport).
- Tests sit beside the code (`*.test.ts`) and run on the mock driver; `src/testing/setup.ts` is the
  bunfig preload that pins the environment before any module reads `config`.

- Identity is a module too (`modules/auth`, `modules/api-keys`, and `modules/audit` for the append-only
  log). Every authenticated mutation under `/api/v1` is audited by one middleware, so a new route is
  covered without remembering; a handler that knows a created id sets `c.set("audit", { targetId })`.
  Nothing in the audit module may update or delete a row (decision 0031).
- Tracing is OpenTelemetry: `modules/traces` sets up the provider with a Postgres exporter (and an
  optional OTLP one via `SPACES_OTLP_ENDPOINT`). The driver and the store are wrapped by proxies, so a
  new driver method or store method is traced without touching it; multi-step work gets an explicit
  `withSpan`. Spans are swept after `SPACES_TRACE_RETENTION_DAYS` (decision 0032). Better Auth owns `/api/auth/*` and the
  account tables (`packages/db/src/auth-schema.ts`, generated by its CLI — do not hand-edit); the API
  accepts its session cookie, a user's API key, or the operator key (`SPACES_API_KEY`). Who somebody is
  is carried on `AsyncLocalStorage` (`src/scope.ts`) and every owned read is filtered in `db.ts`,
  so a handler cannot forget to scope (docs/decision/0028). Services never take an owner parameter.

Dependency direction: `driver` ← everything; `sandboxes` ← `files`, `commands`, `snapshots`, `ports`,
`ssh`, `usage`; `files` ← `files/sign.ts` users (`snapshots`, `ports`) and ← `transfers`; `transfers` ←
`files` and `snapshots`. No cycles.

### apps/web — React, Vite, TanStack Router, Base UI, Tailwind 4

```
src/routes/         thin pages: read params, compose module components, no business logic
src/modules/<name>/ feature code: components/, hooks/, types.ts, plus a helper file when needed
src/components/     feature-agnostic UI: console/ (button, panel, tabs, notice, …), ui/ (shadcn),
                    reui/ (registry components) — vendored ones are re-installed, not hand-edited
src/lib/            singletons and thin clients: api.ts, format.ts, use-poll.ts, utils.ts
```

- Layering: `routes -> modules/<name>/components -> modules/<name>/hooks`. Routes and components never
  reach past a hook for state, and mutations live in hooks, together with their toasts
  (`use-files`, `use-ports`, `use-sandbox-snapshots`, `use-terminal`, …).
- One component or hook per file, kebab-case, named exports.
- Imports: relative inside a module (`../hooks/use-files.ts`), the `@/` alias everywhere else. Never
  `../../` into another module — import it by path (`@/modules/sandboxes/components/sandbox-grid.tsx`).
- `lib/api.ts` is the single typed client for the wire, so the response types it exports stay there;
  module `types.ts` files hold what only the UI layer needs (`Conn`, `Output`, `OpenTab`, …).
- Modules: `connection` (shell status and the key prompts), `auth` (sign in / sign up), `api-keys`,
  `audit` (the log page), `traces` (recent spans and metrics),
  `sandboxes`, `terminal`, `files`, `ports`, `ssh`, `snapshots`, `usage`.
- `lib/auth-client.ts` is the Better Auth client; it is same-origin, so it needs no base URL. The
  console talks to the API for everything else, including `/api/v1/me`, which is how the shell knows
  whether it is an operator key or a person.

## Working style

- Small atomic commits, short imperative subject. Run `bun run typecheck`, `bun run test` and
  `bun run build` before committing, and check the console in a browser when you touched it.
- Do not commit, push, merge or release unless asked.
- Record a significant choice in `docs/decision/` in the same change.

## Known debt

- `aven/no-comments` and `no-inline-comments` are not enabled yet: spaces keeps its "why" next to the
  code (919 comment lines). After Phase 5, in a pass with nothing else in it, move the load-bearing
  notes into `docs/decision/` and `docs/internals.md`, then turn the rules on. See decision 0029.
- `aven/no-native-primitives` is off until the console's native `<button>`/`<input>` elements are
  replaced on purpose; it is a UI change, not a lint fix.
