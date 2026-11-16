# 0014 — Port publishing: pre-publish common ports and disclose restarts

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`POST /sandboxes/{id}/host` must expose a guest port. msb's `modify -p` refuses to change a **running**
microVM without being told how to apply the change:

```
error: cannot modify "bx_…" without a restart
  → port requires restart: - -> 127.0.0.1:22000:3000/tcp
  → run `msb modify … --restart` to apply now
```

`--restart` works and takes **484 ms**, keeps the disk — and kills every process inside. So a naive
implementation silently sabotages the common flow: start a dev server, publish its port, lose the
server.

## Decision

1. **Pre-publish** a configurable set of common dev-server ports at create time
   (`SPACES_PREPUBLISH_PORTS`, default `3000,3001,4000,5000,5173,8000,8080,8888`), so publishing one of
   them is instant and **never restarts**.
2. Any other port uses `--restart` and the response says `restartRequired: true` with a message naming
   the cause.
3. The URL is served by the API as a **preview proxy** with its own `_token`, so it opens in a browser
   (a bearer header cannot be sent from an `<a>`). Method, path, query, body and status all forward.
4. Ports bound to loopback on the host (`SPACES_PORT_BIND=127.0.0.1`), not a public interface.
5. Rows carry an `explicit` flag so ports merely reserved at create are never reported as published
   (see 0021).

## Consequences

- Publishing a typical dev server is instant and non-destructive; the destructive path is opt-in and
  announced.
- Eight host ports are reserved per sandbox at create. Bounded, and allocatable from
  `SPACES_PORT_RANGE_START`/`_END`.
- Every sandbox ends up with eight mapped-but-silent ports. Hence the `explicit` flag and an allocator
  that probes real bindability rather than trusting the database (see 0017).
- Published ports survive stop/resume and are released on delete, so the host port can be reused.

## Alternatives considered

- **Always restart.** Rejected: surprises the user by killing what they just started.
- **Publish a large guest range.** Rejected: a contiguous window cannot cover 3000 and 8080 together,
  and each mapping is a bound socket.
- **Wait for msb to support live port addition.** Not in 0.7.15; the pre-publish list is a bridge that
  costs little if it ever arrives.
