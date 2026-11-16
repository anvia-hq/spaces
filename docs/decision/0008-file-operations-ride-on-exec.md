# 0008 — File operations ride on `exec`, not `msb copy`

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`msb copy` exists and is the obvious tool for moving files into and out of a sandbox. The file API
needs read, write, list, stat, move, mkdir, chmod, glob, content search and bulk replace — several of
which `copy` cannot express at all.

## Decision

Implement every file operation as a **guest shell snippet over `msb exec`**, with bytes carried as
base64:

- **read** — `base64 < path`, decoded host-side.
- **write** — base64 on stdin to `base64 -d > path`.
- **listings** — NUL-framed (`%s\0`), so a filename containing a tab or newline survives.

## Consequences

- **No host temp files.** `copy` round-trips through the host filesystem, which means disk churn, a
  cleanup obligation, and a leak if the process dies mid-copy.
- **Identical local and remote.** The same snippet runs whether `msb` is local or reached over SSH.
- **Binary safe.** Nothing passes through an argv, so NUL bytes and newlines cannot truncate a write.
- NUL framing is not cosmetic: newline-framed listings silently corrupt the output for any file whose
  name contains a newline, which is legal on POSIX.
- Costs: ~33% base64 overhead, and inline reads are capped at 5 MiB — the reason signed transfer URLs
  exist for larger payloads (0009). The 5 MiB cap is a product decision, not a transport limit.
- Each operation is a shell snippet to maintain and to keep POSIX-compatible (busybox, not bash).

## Alternatives considered

- **`msb copy` for read/write plus `exec` for the rest.** Rejected: two transports, two failure
  modes, and a host temp directory to secure and clean.
- **A guest HTTP agent for files.** Rejected: exactly the agent 0001 removed.
