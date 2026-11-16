# 0009 — Two layers of path safety, and symlinks are never followed on delete

- **Status:** accepted
- **Date:** 2026-11-15

## Context

Every file endpoint accepts a path from an untrusted caller and hands it to a guest shell. `../..`
traversal is the obvious attack; a **symlink inside the sandbox pointing out of it** is the one that
is easy to miss, because the path string looks innocent.

## Decision

Validate twice, because the layers catch different things:

1. **Host-side, lexical.** `resolveSandboxPath()` collapses `..` and requires the result to be under
   `/home/user` or `/tmp`. Cheap, rejects traversal before any round trip.
2. **Guest-side, canonical.** Each script resolves its path with `readlink -f` over the longest
   existing prefix, re-checks the roots, and answers `400 invalid_path` with `EBADPATH`.

For `info`, `delete` and `move` the **leaf is deliberately left unresolved**, so a symlink is
described, deleted or moved _as a link_ rather than followed.

## Consequences

- A `..` escape never reaches the guest; a symlink escape is caught by the guest, which is the only
  place with enough information to catch it.
- `DELETE /files?path=/home/user/link` where `link → /etc` removes the link and leaves `/etc`
  untouched. Without the unresolved leaf this was a real `rm -rf /etc` in testing, which is why the
  rule exists.
- The rule is written down in `docs/internals.md` ("a symlink is deleted itself, never its target"),
  so behaviour and documentation agree here.
- Cost: two implementations of the same rule to keep in sync, and every new file operation must
  remember to canonicalise.

## Alternatives considered

- **Host-side only.** Rejected: cannot see symlinks inside the guest.
- **Guest-side only.** Rejected: every traversal attempt costs a round trip, and the host cannot
  reject obviously bad input early.
- **Resolve the leaf too.** Rejected: convenient, and dangerous — it converts "delete this link" into
  "delete what it points at".
