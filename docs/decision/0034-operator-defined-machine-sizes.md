# 0034 — Machine sizes are operator-owned data

## Context

A sandbox's size was an enum in the wire contract: `small | default | large | xlarge`, resolved by
`MACHINE_SIZES` in `packages/shared/src/sandbox.ts` and turned into `msb create -c <vcpu> -m <mib>M`
by the microsandbox driver. Four numbers, in three places, changed only by shipping a new release.

That is the wrong owner. Which shapes a deployment can boot is a property of the machine it runs on
and of the person paying for it, not of the software: a laptop wants a 1-vCPU preset that costs
nothing to leave up, a server with 128 cores wants sizes nobody else does, and a deployment that
outgrew `xlarge` had no way to say so. The operator already holds `SPACES_API_KEY` and configures
everything else about the host; the one thing it could not configure was the shape of a sandbox.

The alternatives were worse. Adding names to the enum still means a release per preset. Reading a
`SPACES_MACHINE_SIZES` JSON variable keeps the list outside the database, so it cannot be edited
while the server runs, cannot be audited, and cannot be read by the console without a second
endpoint that returns the parsed variable. Per-sandbox `{vcpu, memMib, diskGb}` in the create body
removes the preset entirely and moves the decision to every caller — including the ones that only
want "the usual size".

## Decision

**A preset is a row.** `machine_sizes` holds `name`, `vcpu`, `mem_mib`, `disk_gb`, an optional
`description`, `retired_at`, and timestamps. The four presets that existed are seeded by migration
`0004`, with their exact numbers, so a client that sends `{"type":"small"}` sees no change.

**The operator owns the list.** `GET /machine-sizes` is readable by any authenticated caller,
because the console has to render the choices. `POST`, `PATCH` and `DELETE` on
`/machine-sizes/{name}` require the operator key: a session cookie or a user's API key answers `403`
with the reason. Every change is written to the audit log by the existing mutation middleware, with
the preset name as the target (`machine_size.create`, `.update`, `.retire`).

**`type` is a name, not an enum.** The wire schema is `z.string().regex(/^[a-z][a-z0-9-]{0,31}$/)`
so a client can name a preset that was created a second ago without a schema change. It is validated
where it is _used_: create, resume and fork resolve the name against the table and refuse anything
unknown or retired with `404 not_found` and a message saying which (the honest-refusal rule of
0021). No names are reserved for the future; reserving `huge` today would only take it away from
the operator tomorrow. `default` is the one name that means something: it is what a create without
a `type` gets, and it cannot be retired.

**Retiring is soft.** `DELETE /machine-sizes/{name}` sets `retired_at` and keeps the row. Sandboxes
already created at that size keep their `type` and stay readable; they simply cannot be created or
resumed into again, and the console says "preset no longer offered" where it would otherwise print
resources. A hard delete would turn every historical sandbox into a dangling name, and the audit log
and the event log both refer to sizes by name. The response carries `inUse` — how many sandboxes were
created at that size — so an operator knows what it is retiring before it is gone from the list.
Retiring twice is idempotent and keeps the first timestamp.

**Ranges are validated at the edge.** 1–64 vCPU, 512 MiB–256 GiB of RAM, 5 GiB–2 TiB of disk. Wide
enough for anything a single `msb` host can take, narrow enough that a typo (`vcpu: 4096`) is a `400`
naming the field rather than a boot that fails minutes later inside the driver.

**The driver is handed numbers, never names.** `CreateOptions` carries `size: {vcpu, memMib, diskGb}`
resolved from the table at create time, next to the `type` name that stays on the row, in the events
and in the mock's answers. `MACHINE_SIZES` is gone from `packages/shared`, and no driver imports a
size table. This is what makes a preset the operator invented a moment ago bootable at all: an
in-memory table in the API process would have been enough for the contract, but the driver would
still have had to look the name up somewhere.

**Billing follows vCPU.** `BILLING_MULTIPLIER` was a `Record<SandboxType, number>` and would have
priced every new preset as `1`. The multiplier is now boat's rate at `default` (1 at 4 vCPU) scaled
by the vCPU the sandbox actually has, which reproduces the old four exactly (0.5, 1, 2, 4.44…) and
extends to any preset.

## Consequences

- A sandbox's `type` on the wire is a string. A client that switches exhaustively on the four old
  names still compiles against `SandboxType` (it is `string`), but it must not assume those four are
  the only ones — `GET /limits` `allowedTypes` and `GET /machine-sizes` are the list.
- `msb` sizes machines at create time only. Patching a preset does **not** resize sandboxes already
  booted at it: a resume boots the disk with the preset's current numbers, which is boat's behaviour
  for `POST /sandboxes/{id}/resume` with a `type`, and the disk keeps whatever partition table it
  was made with. `diskGb` is recorded and exposed but not passed to `msb create` — the base image
  sizes its own filesystem, and passing a disk size the image does not support would fail the boot.
  That is deliberately unchanged from before this decision.
- The console fetches the list through one hook (`useMachineSizes`) and reads a sandbox's size from
  it; a sandbox whose preset was hard-deleted by a database operator shows its raw type name rather
  than an empty cell.
- Migration `0003` is the generated file with `CREATE TABLE IF NOT EXISTS` in place of `CREATE
  TABLE`. The test suite imports the app from eight files in one process, and each import applies
  the journal again onto the schema the previous file left behind (drizzle records one hash for the
  whole journal, so the replay is not skipped); the `IF NOT EXISTS` is what lets it run clean on
  boot-create and on replay without a second mechanism. `bun run test` therefore passes as one run,
  and a database migrated from an earlier release is unaffected.
