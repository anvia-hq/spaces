# 0011 — Snapshots capture the disk, not memory

- **Status:** accepted
- **Date:** 2026-11-15

## Context

msb can capture **full** snapshots — memory and execution state included — and restore one in 222 ms.
That is genuinely better technology than a disk snapshot, and the temptation was to use it.

But stop and resume are the API's plainest promise: `stop` frees the machine and keeps the disk,
`resume` boots that disk, and running programs do not survive. Clients are built on that reading — a
resumed sandbox is expected to behave like a fresh boot with its files intact, not a paused process
that resumes mid-syscall.

## Decision

Wire snapshots to the **disk only**. Do not expose memory snapshots through `stop` and `resume`.

## Consequences

- Stop and resume mean the same thing for every client, whatever it assumed about the machine. No
  resumed process, no memory captured under one kernel replayed under another.
- Deterministic and easy to reason about: no half-restored processes, no ordering hazard between a
  restored memory image and the files it was holding.
- Disk snapshots are fast (26 ms) and cheap, which suits the "create one per task" workflow.
- We knowingly leave 222 ms full-restore on the table. If it is ever wanted, it belongs behind a new
  endpoint with its own name, so nobody's assumptions change underneath them.
- Fork is unaffected: it is copy-on-write on a running machine, not a snapshot restore.

## Alternatives considered

- **Use full snapshots and document the difference.** Rejected: silent semantic change to `resume`.
- **Expose both, chosen by a flag.** Rejected for now: one more axis for every client to get wrong,
  with no user asking for it.