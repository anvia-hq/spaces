# 0012 — Background commands use `setsid`, and logs are read by byte offset

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`detached: true` and `stream: true` have to mean something. The naive implementation — append `&` and
return — appeared to work and was silently broken.

Measurement settled it: a plain `cmd &` inside the guest does **not** detach. `msb exec` waits for its
children, so starting a 5-second child held the API call for **5018 ms**. The client received a
"started" response five seconds late, at which point the command had finished.

## Decision

Launch through `setsid` with all three descriptors detached:

```sh
setsid "$dir/run.sh" </dev/null >/dev/null 2>&1 &
```

This returns in ~50 ms and the child outlives the exec. State lives in the guest under
`/tmp/.spaces/proc/<commandId>/` — `out`, `err`, `exit`, `pid`, `cmd`. `pid` is the process **group**
id so `DELETE` can signal everything the command started.

Logs are read by **byte offset**: the guest serves `tail -c +<offset+1>`, so a polling client only
transfers what is new, and `GET /commands/{processId}` answers with `stdoutNextOffset`.

The public `processId` is the guest pid, so the `commands` table stores `pid`: pid → commandId must
still resolve after the process has left the live process table.

## Consequences

- `detached` returns in ~50 ms; `stream` emits frames as output appears (~150 ms polling cadence)
  rather than at the end.
- Polling is O(new output), not O(total output) — a build that runs for minutes costs the same per
  poll as one that just started.
- Killing uses the process group, so `npm run build` dies with its children instead of orphaning them.
- A guest crash leaves stale directories under `/tmp/.spaces/proc`; they are harmless and bounded by
  the sandbox's lifetime.
- Streaming is _pseudo_-streaming: `msb exec` cannot carry a live pipe, so frames are produced by
  polling a file. Latency is bounded by the poll interval, which is the honest limit of this transport.

## Alternatives considered

- **`nohup` + `&`.** Rejected: measured, still blocks the exec — the descriptor detachment is what
  matters, not the signal handling.
- **A supervisor process in the guest.** Rejected: another agent to maintain (see 0001).
- **Whole-log reads on every poll.** Rejected: transfers the entire log each time; unusable for a
  long build.
