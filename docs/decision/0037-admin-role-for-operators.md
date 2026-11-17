# 0037 — The admin role, so an operator is an account and not only a secret

- **Status:** accepted
- **Date:** 2026-11-17

## Context

`SPACES_API_KEY` is the operator: one bearer token that sees every sandbox, every user's rows and
every preset, and that is also the only way to change what the deployment offers (0034). That was
the right shape for a machine with one person on it and no console (0022). It stopped being right
when the console grew a login (0033): the person who runs the box now signs in like everybody else,
and every operator-only surface answers them `403 forbidden` with a message telling them to paste a
secret into `curl`. The key also cannot be revoked per person, cannot be tied to a name in the audit
log, and is at best awkward from a browser — the console deliberately does not hold it.

Two failure modes push the same way. A deployment upgraded from a single-key install has a person
account already (`me@indrazm.com` on the homelab), and has no way to become an admin from the
console. And a second person who should be allowed to add a machine preset needs the whole key,
which also lets them read every sandbox on the box.

## Decision

**Admin is a role on the account.** Better Auth's own `admin` plugin owns `role` and `banned` on the
`user` row (its schema, generated into `packages/db/src/auth-schema.ts` by `bun run --cwd apps/api
auth:schema`), and `scope.ts` promotes such a user to the same scope the operator key gets: it sees
every row, and its rows are still stamped with its own id. A key inherits the role of the account
that owns it — a key is that person's credential, in CI as in a browser. The operator key is
untouched: it is still an operator, still unscoped, still what an existing client sends.

**One predicate.** `mayOperate(principal)` — the key, or a user whose role contains `admin` — is the
single answer to "may act as the operator". The machine-size gate and the new user routes both call
it; a second copy of that question is how the two answers drift apart.

**Bootstrap is the environment, membership is the API.** `SPACES_ADMIN_EMAILS` (comma separated,
empty by default) is read at boot and on every sign-in/sign-up: an account whose address is on the
list is promoted once, and the promotion is its own audit action (`auth.admin_bootstrap`, actor
`system`, label `SPACES_ADMIN_EMAILS`). The boot pass is what covers an account that already existed,
so an upgraded deployment needs no SQL step. After the first admin exists, they promote the rest
from the console (`POST /api/v1/users/{id}/role`), and the variable can be emptied — it is a
bootstrap path, not the membership list, and an emptied list never demotes anybody.

**Refusing to lock the deployment.** Demoting or banning the last admin is a `403` with the reason:
otherwise nobody could promote anybody back, and the only way in would be the environment variable
of a process somebody has to restart. The check counts admins, so it is only wrong for the instant
two admins demote each other.

**What an admin may not do.** `role` is `admin` or `user`; the API sets no other value. Admin rights
are not a tenancy: an admin sees every row because that is what the operator key already does
(0028), not because accounts belong to an organisation. Impersonation, user creation from the admin
surface and password setting stay off — they are Better Auth endpoints that would put a second,
unaudited authorization path under `/api/auth`, and nothing here needs them.

## Consequences

- Migration `0005` adds `role`, `banned`, `ban_reason`, `ban_expires` and the session's
  `impersonated_by`, all nullable, `banned DEFAULT false`. It is additive: an existing database keeps
  every row, existing users get `role = NULL`, which the API reads as `user` (`role ?? "user"`), and
  a fresh row gets the plugin's default. Nothing has to be backfilled for the upgrade to be safe; the
  first sign-in after the upgrade is what promotes a listed address.
- Every authenticated request re-reads the user row, so a role change or a ban applies to the next
  request rather than the next session. A ban also refuses new sessions (the plugin's own hook).
- Better Auth's session freshness check (`freshAge`) is `0` instead of its default day, so its own
  endpoints and this API do not disagree about a session being "too old to be an admin".
- A promoted account can read every sandbox on the deployment. That is the same reach the operator
  key already has, and the reason promoting somebody is an audited, visible act rather than a quiet
  column edit.
- `403` on a machine-size write now carries `code: "forbidden"` rather than
  `machine_class_plan_required`. It is the same status and the same route; the message names the two
  ways in. The old code was a boat leftover and nothing matched on it.
- The console reads `admin` from `GET /api/v1/me`. A surface that is operator-only today shows for an
  admin with no separate check.

## Alternatives

- **A second shared secret for admins.** Rotating it is a restart for everyone, it still cannot name
  the person who changed a preset, and it repeats the problem it was meant to solve: a credential in
  a browser. A role is one column and one audit entry.
- **A hand-rolled `is_admin` column.** It would duplicate what the plugin ships (the role list, the
  ban fields, the session freshness rule) and would drift from Better Auth's own authorization as
  soon as anybody called one of its endpoints. Using the plugin and switching its `/admin/*` routes
  off keeps one schema and one vocabulary.
- **Let Better Auth's `/api/auth/admin/*` routes be the API.** They are a second HTTP surface with
  their own gate, outside `/api/v1`, and outside the one audit middleware: a promotion made there
  would leave no row in the log (0031).
- **Promote from `SPACES_ADMIN_EMAILS` on every request.** Reading the variable on each request makes
  removing an address silently demote a person mid-session, and makes the promotion unauditable
  because it happens constantly. Boot plus sign-in is the same coverage with one row per promotion.
- **Make the operator key the admin account's key.** It would tie a credential that predates
  accounts to an account that may not exist, and rotating it would have to migrate rows (0028 says
  the same thing about the operator key generally).
