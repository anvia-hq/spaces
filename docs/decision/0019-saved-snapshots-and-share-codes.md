# 0019 — Saved snapshots, and share codes stored as hashes

- **Status:** accepted
- **Date:** 2026-11-15

## Context

Two spellings exist for the same idea: `/named-snapshots` (deprecated) and `/saved-snapshots`
(current). Both describe a disk frozen under a **name** that survives the source sandbox, can be
re-saved to replace the artifact, and can be shared with a secret code.

## Decision

Implement `/saved-snapshots` as the real surface and keep `/named-snapshots` as thin aliases over the
same rows, differing only in the reported `type`. Share codes are:

- generated server-side as `bsh_` + 32 hex characters,
- stored **only as SHA-256**, with a `codePrefix` for display,
- returned **once**, in the create response,
- revocable by id, and never re-readable.

Deleting a snapshot artifact also deletes any saved-snapshot name and share codes pointing at it, so no
row can reference a disk that no longer exists.

## Consequences

- A leaked database does not leak working share codes.
- Losing the code means creating a new one — the same trade-off as any bearer secret, and stated plainly
  in the UI ("shown once, copy it now").
- Re-saving a name releases the previous artifact first, so storage does not grow silently on repeated
  saves.
- Aliases are cheap but permanent: two routes to maintain for as long as a client still calls the old
  one.
- `status` is `saving | ready | failed`, but saves here complete in milliseconds, so `saving` is
  effectively transient. The field is part of the response shape (0002); saves here never linger in
  it.

## Alternatives considered

- **Store the code in plaintext for re-display.** Rejected: a share code is a bearer credential.
- **Implement only `/named-snapshots`.** Rejected: it is the deprecated spelling; anything new uses
  the current name.
