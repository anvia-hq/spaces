# 0028 — Accounts, API keys, and one owner per resource

- **Status:** accepted, narrowed by [0044](./0044-a-cluster-is-one-team.md)
- **Date:** 2026-11-16

## Context

Until now the API had exactly one credential: `SPACES_API_KEY`, compared against the `Authorization`
header. 0022 recorded why — a self-hosted runtime with no accounts has nobody to share anything with,
and decision 0003 keeps the SaaS surface (organizations, members, billing) out on purpose.

Two things changed. The console is the product now, and a console that greets every person with the
same pasted secret cannot show "your sandboxes". And clients want to hand a key to a CI job that must
not be able to touch anything else. Neither is an organization feature; both are one user with a key.

There is a hard constraint on the way: a client already drives this server with the static key
(`SPACES_API_KEY`), from the environment. Whatever is built, that key has to keep working across the
deploy.

## Decision

**Add Better Auth for people, keep the operator key, and scope data by owner.**

- `better-auth` (email + password, the `@better-auth/api-key` plugin) owns the account tables and the
  `/api/auth/*` surface: sign-up, sign-in, sign-out, session cookie. The console uses it; a person can
  sign up, sign in, create keys, and revoke them.
- Three credentials are accepted on `/api/v1`:
  **the operator key** (`SPACES_API_KEY`, unscoped — sees everything), **a user's API key** (Bearer,
  resolved through `verifyApiKey`), and **a session cookie**. A valid session wins over a bearer token,
  because a browser that is signed in should act as that person even though the console still seeds the
  local dev key.
- Sandboxes, snapshots and saved snapshots get `owner_id` (Better Auth user id, null for the operator).
  Snapshots copy the owner of the sandbox they came from.
- Scoping happens in the `store`, not in fifty handlers: the principal is put in an
  `AsyncLocalStorage` scope for the request, and every read that could return a row with an owner
  filters on it (`store.list`, `raw`, `getSnapshot`, `listSnapshots`, `getSavedSnapshot`,
  `listSavedSnapshots`, plus events and command history which gate on the sandbox's visibility).
  Somebody else's row looks exactly like a row that does not exist: `404`, not `403`.
  Work with no scope — the reaper, provisioning, migrations — sees everything, which is what system
  work should see.
- Keys are managed only by a session: a key must not be able to mint another key, and the operator key
  does not create user keys. `GET/POST/DELETE /api/v1/api-keys` answer `403` with the reason otherwise.
- `SPACES_API_KEY=` (empty) turns the operator key off; then only sessions and user keys work.

## Consequences

- A deployment that keeps `SPACES_API_KEY` and adds `SPACES_AUTH_SECRET` keeps every existing client
  working unchanged: same header, same routes, same responses. Sandboxes created by it have
  `owner_id = NULL` and stay invisible to user accounts, so an existing fleet does not leak into a new
  account's console.
- The console's local-first default (a dev key on `localhost`) is unchanged, so `bun run dev` still
  works with no sign-up. To exercise a real account locally, sign in — the session takes precedence.
- One credential check runs `getSession` on every `/api/v1` request, which is one indexed SQLite read
  on the same connection the request is about to use anyway.
- The `AsyncLocalStorage` scope is implicit, and implicit is a real cost: a future query that bypasses
  `store` and reaches a table directly would not be filtered. The mitigation is that every owned table
  is only read through `store`, and the module layout (0027) keeps that reachable from one file.
- Ownership is not enforced on writes, only on reads: a handler that somehow got a foreign id would
  fail at its first `requireSandbox` (`store.raw` returns null), which is where every one of them
  starts.

## Alternatives

- **Keep the single key and add a "read-only" variant.** Two keys is not accounts; the console still
  could not show a person their own work.
- **A separate `auth` service or an external IdP.** A self-hosted runtime with a local SQLite file
  should not require an identity provider to boot.
- **Scope every service function by passing `ownerId` explicitly.** A sibling codebase does exactly
  that with `organizationId`, and it is more honest — but it means touching ~55 handlers and every service in
  the same change, and a single missed parameter is an authorization hole. Filtering at the `store`
  is one gate that cannot be forgotten, and it is testable end to end.
- **Make the operator key the admin user's key.** It would tie a credential that predates accounts to
  an account that may not exist, and a secret rotation would have to migrate rows. The operator key
  stays a credential, not a user.
