# 0030 — Postgres, and how the old SQLite data gets there

- **Status:** accepted
- **Date:** 2026-11-16

## Context

Everything lives in one SQLite file (`SPACES_DB`, default `apps/api/.data/spaces.db`), opened with
`bun:sqlite` through `drizzle-orm/bun-sqlite`, migrated at boot from `packages/db/drizzle`. The
`store` in `apps/api/src/db.ts` is a synchronous object: `bun:sqlite` calls return rows, not promises,
so ~150 call sites read like `store.get(id)`.

That was the right call for one process and one host (decision 0006). Two things break it:

- Phase 4 needs an append-only audit log and Phase 5 needs spans — both are high-write, queryable-by-
  time, JSON-shaped tables. SQLite can hold them, but retention, aggregation and concurrent readers
  while a long command streams are exactly what Postgres is for. The brief also wants them to land on
  Postgres directly rather than being migrated again.
- The host already runs Postgres, and a single-file database on the same disk as the sandboxes means a
  disk full of microVM images is also a disk full of the control plane's only copy.

Non-negotiables: the module layout stays, Better Auth keeps working (users, sessions, API keys), the
operator key keeps working, and no existing sandbox, snapshot, saved snapshot or account may be lost
on the deployment host.

## Options

**A. Bun's own Postgres client (`drizzle-orm/bun-sql`), native column types, squash to a fresh
baseline.** No new dependency: `Bun.SQL` ships with the runtime. Timestamps become `timestamptz`
(`mode: "string"`, so the query layer still hands ISO strings to the API), JSON columns
become `jsonb` (drizzle parses them, so `JSON.parse` leaves the store). The SQLite migration history is
replaced by one Postgres baseline, and a one-shot import script carries the rows.

**B. `postgres-js` (or `pg`), keeping the SQLite column shapes.** Cheapest mechanical port: every column
stays `text`/`integer`, ISO timestamps stay text, JSON stays a string, `drizzle.config.ts` changes
dialect and the tables are otherwise untouched. Adds a dependency, and carries SQLite's shape into
Postgres — including text timestamps that need casting for every range query Phase 4/5 will make, and
JSON blobs that cannot be indexed or filtered.

**C. Stay on SQLite and put the audit/trace tables there too.** Zero migration risk now, and it is
honest for a single-process server. But it contradicts the brief, and the retention/aggregation
queries it needs are the ones SQLite is worst at under a concurrent writer.

## Decision

**A**, with these commitments:

- **Driver**: `drizzle-orm/bun-sql` over `Bun.SQL`, one connection pool, configured by
  `SPACES_DATABASE_URL`. No new dependency; swapping to `postgres-js` later is a change inside
  `packages/db/src/index.ts` only, which is why `createDb` exists.
- **Types**: `timestamptz` with `mode: "string"` for every ISO column (the wire keeps strings, SQL gets
  real time), `jsonb` for `labels`, `env`, `events.payload`, `snapshots.manifest` and the Better Auth
  plugin's `permissions`/`metadata`. The store parses and serialises in one place, as it does today.
- **Migrations**: `packages/db/drizzle` is regenerated as a PostgreSQL baseline; the SQLite migrations
  are removed from the working tree (they remain in git history). `drizzle-kit` needs a live database
  for `dbCredentials.url`, so generate/migrate commands take `SPACES_DATABASE_URL`.
- **Async store**: `bun:sqlite` was synchronous, so the store must become async and every caller must
  await it. That is the bulk of the diff and it is typecheck-enforced: no call site can be missed
  silently. `requireSandbox`, `requireLiveSandbox` and the scope-filtered reads become async with it.
- **Data migration**: `scripts/migrate-to-postgres.ts` reads the old SQLite file (read-only, via
  `bun:sqlite`, which stays a Bun builtin and not a dependency) and writes Postgres in foreign-key
  order, converting `0/1` booleans, epoch-millisecond Better Auth timestamps and JSON text on the way.
  It refuses a non-empty target, verifies row counts per table afterwards, and prints counts, never
  the connection string. It runs from the deploy script when an old database is present and the target
  is empty, so a redeploy does the right thing without a second command.
- **Tests**: the API suite runs against a real Postgres database (`SPACES_TEST_DATABASE_URL`,
  defaulting to `postgres://localhost/spaces_test`), with the schema dropped and re-migrated in the
  preload so runs stay independent. CI gets a `postgres:17` service container.
- **Transactions are not introduced.** The write sequences (stop = row + state + event) were never
  atomic under SQLite either; the API is a single process, and the flows that could interleave are the
  same ones that could before. Recorded here as the deliberate gap: when Phase 5 instruments the driver
  calls, wrapping those sequences is the natural time to add it.

## Consequences

- A deployment needs Postgres (`postgresql` on Debian), a role, a database and a password in
  `/etc/spaces/spaces.env` as `SPACES_DATABASE_URL`. The deploy script creates the role and database if
  absent, generates the password once, and never prints it.
- Everyone who runs `bun run dev` needs a local Postgres. `SPACES_DATABASE_URL` defaults to
  `postgres://localhost:5432/spaces` and the README says how to create it; there is no silent
  fallback to a file, because two storage engines in one codebase is how "works on my machine" starts.
- The store's async shape makes a few read-then-write helpers more awkward (a `require` in the middle
  of a loop now awaits), and it loses the accidental atomicity of a synchronous single-writer store.
  The plan for that is the transactions note above, not a reversion.
- `timestamptz` in `mode: "string"` returns `2026-11-16T00:00:00.000Z` — the same shape the API
  already returned, so no response changes; ordering in SQL is now chronological instead of lexicographic.
- **A shipped baseline is never regenerated.** drizzle compares each migration's journal timestamp
  (`folderMillis`) with the last applied row, so regenerating a baseline that has already run makes a
  live database try to re-apply it (`relation already exists`). When the SQL really is unchanged — as
  when a column's TypeScript mode changes — the regenerated file keeps the original journal `when`, so
  deployed databases skip it and fresh ones apply the same bytes. Anything else is a new migration.
- The old SQLite file is left in place on the host after the import (disk is cheap, and deleting the
  only other copy on the same day is how a migration becomes a story).

## Alternatives ruled out

- **Keep the SQLite file as a fallback behind a flag.** Two dialects means two schema files, two
  migration folders and two test paths, forever, for a self-hosted server that already runs Postgres.
- **Copy through dump/restore (`pgloader`, `sqlite3 .dump`).** Neither understands Better Auth's
  epoch-millisecond integers or the JSON text columns; a 60-line script that uses the same Drizzle
  schema as the app is smaller than the mapping file a loader would need, and it fails loudly.
- **A managed Postgres.** It is one host, and the operator already runs the database.
