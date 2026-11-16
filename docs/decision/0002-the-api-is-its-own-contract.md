# 0002 — The API is its own contract

- **Status:** accepted
- **Date:** 2026-11-15

## Context

A sandbox API is only useful if a client can rely on it. The surface started by conforming to an
external sandbox specification: paths, field names, status codes and the error envelope were read out
of somebody else's document and matched exactly.

That worked while the surface was new and had nothing to lose, but it made an outside roadmap the
authority over this product. A field could not be renamed because a foreign document spelled it
differently; a route could not be dropped; the definition of "done" was a coverage count against
operations this server would never implement. The API and the console are the product here, and they
need to change on their own schedule, with their own versioning.

## Decision

**`docs/api.md` is the contract of record.** There is no vendored upstream spec.

- Request and response shapes live in `packages/shared` as zod schemas, one file per domain. The
  server validates every route with them, the console imports the inferred types, and the tests assert
  against them, so shape has one source of truth.
- Semantics that a schema cannot express — what `stop` does to a disk, what `202` means, what a
  `409 sandbox_not_ready` implies — are written in `docs/api.md` and in decision records.
- A change to the surface (a new route, field, status code, or a changed meaning) lands with a
  decision record. Additions are preferred over alterations; a break is a deliberate version change,
  not a quiet edit.

## Consequences

- The surface is judged by this repo's clients, not by a foreign operation list. Coverage is stated
  as what exists, never as a fraction of somebody else's document.
- Earlier choices to match a foreign spec are kept where they are good on their own merits, and each
  now stands on its own argument: `processId` is the guest pid (an integer, and no use as an internal
  id), `sshEndpoint` exists because a machine here has no public IPv4 (0015), snapshots are disk-only
  because a resumed disk is the promise (0011).
- Shape and behaviour can drift apart in one direction only: the compiler and the zod schemas catch a
  shape change, but nothing catches a route that changes meaning while `docs/api.md` keeps the old
  sentence. That is what the gate in the decision list is for.
- **Accepted cost:** tooling written against the old foreign spec is no longer promised to work.
  Compatibility with any given client is answered per route in 0021, not by a global claim.
- Two documents to keep in step (`docs/api.md` and the schemas). They are cheap to diff because the
  reference names the same fields.

## Alternatives considered

- **Keep an external spec as the contract.** Rejected: an outside roadmap then decides our field
  names, our refusals and when we may deprecate anything. It also forces work on operations this
  deployment will never back.
- **Schemas only, no prose reference.** Rejected: a schema says a string is a string. It cannot say
  that `stop` keeps the disk, that `detached` is still bounded by a timeout, or that another account's
  id answers `404`.