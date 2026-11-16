# 0031 — An audit log that cannot be forgotten, and cannot be edited

- **Status:** accepted
- **Date:** 2026-11-16

## Context

Spaces knows a lot about _what happened to a sandbox_ — the `events` table records lifecycle transitions
and the usage meter is derived from it — and nothing about _who did it_. With accounts and API keys
(0028) that gap is a liability: "who deleted that sandbox, from which address, with which key" is the
first question after an incident, and the only answer today is a journal line.

Phase 4 asks for an append-only log of actor, action, target, result, time, request id, IP and
user-agent; queryable per user with filters and pagination, plus a console page. Phase 5 will correlate
request ids with spans, so the same id has to appear here.

Constraints: the log must not become a place where a request can be _silently_ missed, entries must not
be editable or deletable through the API, a user may only see their own entries, and the read path must
stay cheap enough to poll.

## Options

**A. Record explicitly, in each router.**
Every mutating handler calls `audit.record({ action, target, result })` after its service returns.
Pros: precise action names, knows the created id, no magic, easy to test per route. Cons: one forgotten
`record()` call is an invisible hole, and nothing in CI catches it.

**B. Record centrally, in a middleware, from the matched route.**
After `await next()`, a middleware reads the matched template (`POST /sandboxes/:sandboxId/stop`), the
status and the request id, and writes one row through a route→action table. Pros: impossible to forget —
the row is written for every mutating `/api/v1` request, including ones added later; the target is
usually right there in the path. Cons: the middleware cannot know a _created_ id without reading the
response body, and unusual routes need a mapping entry.

**C. Database triggers on every table.**
Pros: cannot be bypassed at all. Cons: triggers only see rows, not people or request ids (which live in
the HTTP layer), and a trigger on `UPDATE` cannot say which fields a caller asked to change. It would
still need the HTTP layer for actor and request id, so it buys nothing but coupling.

## Decision

**B, with a one-line enrichment hook.**

- `modules/audit` owns an `audit_log` table (Postgres, `jsonb` metadata, `timestamptz`), one
  `record()` function, and a read service. It exposes no update or delete path, and the table is
  written only through that function: append-only by construction, and by review.
- A middleware (`modules/audit/middleware.ts`) writes exactly one row for every `POST`, `PUT`,
  `PATCH` and `DELETE` under `/api/v1` that authenticated: actor (operator, user, or the key that was
  used), action (from a route table, defaulting to a normalised template), target (from the route
  params), result and status (from the response, including the error code from our envelope),
  request id, IP and user-agent from the request, and duration.
- A handler that knows something the middleware cannot — a created id — sets `c.set("auditTarget", …)`
  and the middleware folds it in. Three routes do this today (sandbox create, snapshot save, key
  create); everything else is fully described by its path.
- Authentication is recorded from Better Auth's own hooks: `session.create` (sign-in) and
  `session.delete` (sign-out), plus `user.create` (sign-up), with the actor explicit because no request
  scope exists inside a library hook.
- Rows carry `owner_id` (the acting user, null for the operator and for system work) and are read
  through the same scope filter as everything else (0028): a user sees their own entries, the operator
  sees all. System rows (the reaper) are operator-only.
- Read API: `GET /api/v1/audit-log` with `action`, `actor`, `targetType`, `targetId`, `result`,
  `since`, `until`, `limit` and a keyset `cursor` (`at` + `id`), newest first. Keyset, not offset: the
  log grows at the head while it is being paged.
- Console: `/audit`, a table with filters and "load more", the actor and action on each row, the
  status, and a copy button for the request id so it can be pasted into a trace or a grep.

## Consequences

- Coverage is a property of the middleware, not of discipline: a route added next week is audited
  without anyone remembering. The cost is that unusual routes produce a mechanical action name until
  somebody adds a mapping entry — visible in the UI, which is the right kind of pressure.
- Bodies are never logged (paths, ids, statuses only). A file upload's _content_ is not an audit
  concern, and logging request bodies is how secrets end up in a table.
- `GET` requests are not audited. Reads of other users' data are already impossible (0028), and logging
  every poll would drown the mutations the log exists for. Documented as a scope decision.
- Signed-URL writes (`PUT /_transfer/:token`) are not audited: they carry a token, not an actor, and
  the token was minted by a request that is. Recorded here so the gap is a decision, not an oversight.
- The log is append-only in code, not in the database: the application role can still `UPDATE` it. A
  trigger or a separate role for retention is the next step if the threat model changes; today the only
  thing writing to the table is one function with no update path.
- Volume: one insert per mutating request, one index on `(owner_id, at desc)`, one on `(at desc)`.

## Alternatives ruled out

- **Reuse the `events` table.** It is per-sandbox lifecycle with a different meaning and a different
  lifetime; snapshots and accounts have no sandbox to hang from.
- **Log to the journal (`console.log`) only.** Not queryable, not scoped, and gone after a log rotation.
- **Ship to an external SIEM.** Phase 5 offers OTLP export for traces; an audit log that only exists
  elsewhere would break the self-hosted promise of this server.
