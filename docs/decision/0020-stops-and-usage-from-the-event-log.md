# 0020 — Stop operations as rows, usage derived from the event log

- **Status:** accepted
- **Date:** 2026-11-15

## Context

Two parts of the surface need history rather than current state:

- `POST /stop` returns a **stop operation** with an id that stays readable after a resume or a later
  stop. The first implementation returned `newId("stop")` — a fresh random id that was never stored, so
  `GET /stops/{stopId}` could not have worked for any input.
- `GET /usage` reports billable machine-seconds for a window, including a sandbox that has since stopped.
  That requires knowing when it was running, which is not a column but a history.

## Decision

- **Stops are rows** in a `stops` table, created _before_ any work so a caller can always poll them,
  reused by repeat calls while pending, marked `completed` on success, `failing` (sandbox left running)
  when the archive fails, and `superseded` when a resume ends them early.
- **Usage is derived** by walking the sandbox's event log into running stretches
  (`sandbox.ready`/`resumed` → `sandbox.stopping`/`stopped`/`deleted`), intersecting them with the
  requested window, and applying the machine-type multiplier (0.5 / 1 / 2 / 50⁄9).

No separate metrics store: the `events` table is already written for every lifecycle transition.

## Consequences

- `GET /stops/{stopId}` is correct after resume and after later stops, and returns `404` for another
  sandbox's stop rather than leaking it.
- A failed archive no longer discards the disk: the sandbox keeps running and the stop carries the error.
- Usage is exact for any window, including retroactively, with no background aggregation job.
- Arithmetic happens in code, not SQL, because timestamps are ISO text (0006). Fine at this scale.
- Cost: the event log becomes load-bearing, so event writes must not be skipped casually — a missing
  `sandbox.ready` silently under-bills a sandbox.

## Alternatives considered

- **Track a `runningSince` column and accumulate on stop.** Rejected: loses history, cannot answer
  "usage in the last 24 h" or a window that spans several stop/resume cycles.
- **A separate usage/interval table.** Rejected as duplication: the events already describe exactly the
  stretches, and a second source of truth would drift.
