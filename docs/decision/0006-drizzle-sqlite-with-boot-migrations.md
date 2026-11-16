# 0006 — Drizzle over bun:sqlite, migrations applied at boot

- **Status:** accepted
- **Date:** 2026-11-15

## Context

The server needs durable state: sandboxes, snapshots, commands, stops, saved snapshots, shares,
published ports, events. It is a single-node, self-hosted tool started by one operator with
`bun run dev` or a systemd unit.

## Decision

`bun:sqlite` (a file, WAL mode) through Drizzle ORM. Schemas live in `packages/db/src/schema.ts`,
migrations are generated into `packages/db/drizzle/` and **applied automatically at startup**.

Timestamps are stored as ISO-8601 **text**, not integers.

## Consequences

- Zero external services. `bun run dev` works on a clean machine with no database to provision.
- Restarting with a new schema just works; there is no "run the migration" step to forget.
- A corrupt or lost DB loses metadata, not sandboxes: the `.db` is a local dev convenience and msb
  owns the actual machines.
- Text timestamps keep values byte-identical to what crosses the HTTP boundary, so nothing has to
  convert on the way out. Cost: no native date arithmetic in SQL — the usage meter does its
  arithmetic in code instead (see 0020).
- Single-writer concurrency. Fine for one operator; a reason this is not a multi-tenant service.

## Alternatives considered

- **Postgres.** Rejected: another daemon to run and back up for a tool whose whole pitch is "runs on
  the machine in front of you".
- **JSON files.** Rejected: snapshots, commands and events are relational, and the usage meter wants
  ordered reads.
