# 0003 — No account or SaaS surface

- **Status:** accepted
- **Date:** 2026-11-15

## Context

This server is one machine, one operator, one credential. Organizations, seats, usage-based billing,
webhooks and CI integrations describe a business this deployment does not have — they were part of an
earlier, external specification whose tenancy half never applied here.

## Decision

Do **not** implement them, and do not stub them. They return `404` like any unknown path.

## Consequences

- The surface stays honest: a 404 means "no such thing", not "we chose not to".
- Coverage is stated as what exists, never as a percentage of somebody else's operation list, so the
  number is not inflated by routes that would be theatre.
- A client that expects `/orgs` fails fast and visibly rather than receiving a plausible-looking
  object that means nothing.
- Accounts do exist (0028), but only to own resources on this machine: no organizations, no seats, no
  billing, no invitation flow.
- If multi-tenancy is ever wanted, it is a new decision, not an extension of this one.

## Alternatives considered

- **Stub them with empty data.** Rejected: a fake `/orgs` response is worse than an absent one — it
  teaches clients to trust a lie. This is why the routes that _do_ exist but cannot be backed answer
  `501` with a reason (see 0021) instead.