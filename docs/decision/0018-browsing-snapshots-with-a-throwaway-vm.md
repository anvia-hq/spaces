# 0018 — Browsing a snapshot by booting a throwaway VM

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`GET /snapshots/{id}/tree`, `/files` and `/download` exist so the files inside a snapshot can be
inspected **without starting the source sandbox** — which is the point of a snapshot. msb stores a
snapshot as a raw disk layer plus a JSON descriptor; there is no API to read files out of it, and
mounting raw images requires privileges the API does not have.

## Decision

Materialise the snapshot into a **throwaway sandbox** (`msb restore <group>:<member>`), run the read
there, and always tear it down in a `finally`. Cache the resulting listing on the snapshot row, since a
snapshot is immutable:

- `GET /snapshots/{id}/tree` — flat listing, built on first read and cached.
- `GET /snapshots/{id}/files` — file bytes, or a subtree tar; `Range` yields `206`.
- `GET /snapshots/{id}/download` — one signed chunk URL that streams the workdir tar.

Two implementation notes that cost real time: the selector is `group:member` (a `snap:` prefix and
`--disk-only` are both rejected by msb), and the reads must go through the driver's argv-passing helpers
rather than a hand-quoted `sh -c`, which silently mangled the script.

## Consequences

- Files are readable after the sandbox is stopped **or deleted**, which is what makes a snapshot a
  backup rather than a bookmark.
- Tree browsing is **415 ms cold, 10 ms cached**; file reads pay one VM boot.
- Bounded by a 20,000-entry cap, with `truncated` reported rather than a silent cut.
- Path traversal in snapshot paths is filtered (leading slashes and `..` segments dropped), and an
  escape attempt returns `404` rather than reading the throwaway VM's `/etc`.
- Every browse boots a microVM. Acceptable because snapshots are inspected rarely and caching absorbs
  the repeated case; a disk-image parser would be the better long-term answer.

## Alternatives considered

- **Mount the raw layer on the host.** Rejected: requires root, and breaks the "no privileges" property.
- **Store a manifest at snapshot time.** Attractive — the source sandbox is alive then — but it only
  solves `/tree`, not `/files`, and would miss snapshots taken before the feature. Caching on first read
  covers the same ground for both.
- **Skip browsing.** Rejected: a snapshot you can only clone is a bookmark, not a backup.
