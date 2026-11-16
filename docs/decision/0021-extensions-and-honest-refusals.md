# 0021 — Additive extensions and honest refusals

- **Status:** accepted
- **Date:** 2026-11-15

## Context

The surface (0002) covers sandboxes, files, commands, snapshots, ports, SSH and usage. Two kinds of
gap survive that are not about laziness:

1. **Missing capability.** A few routes are declared by older clients but nothing here can back them —
   no display server for `/desktop`, no integrated AI agent for `/prompt`, no organizations for
   `/share`.
2. **Missing information.** The server tracks published ports in `sandbox_ports`, but no earlier route
   lists them, so a client cannot see what it published. The console needed it.

## Decision

**Refusals are explicit.** Routes that exist but cannot be backed answer
`501 provider_not_configured` with a message naming the actual reason. They never return a fake success
(a client would trust it) and never return `404` (indistinguishable from a typo).

**Extensions are additive and marked.** Behaviour the surface does not cover is added without changing
any existing route:

- `GET /sandboxes/{id}/ports` — the published ports, documented as an extension in `docs/api.md`.
- The `explicit` flag on a port row — distinguishes ports someone asked for from the ones merely
  reserved at create (0014). Without it the console would report eight published ports nobody published.

## Accepted but not acted on

A third category emerged once the surface was exercised by real clients: request fields that exist for
someone else's workflow and mean nothing here. Rejecting them breaks a client that is speaking the
shape it was given; silently accepting them is a lie unless it is written down.

So `CreateSandboxRequest` names every field it tolerates and leaves `.strict()` on. Strictness is what
separates "we know this field and chose not to act on it" from "nobody defines this":

| Field                                                 | What happens                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`, `ttlSeconds`, `labels`, `env`, `name`         | Honoured. `env` is injected into the guest with `msb create -e`                                                                                                                                                      |
| `from`                                                | Honoured for a sandbox id. A saved-snapshot name or `bsh_` share code answers `404 snapshot_not_found` — creating a _fresh_ sandbox instead would look like success while discarding what was asked for              |
| `setupScript`                                         | Honoured. Runs once after `ready` as `user`; the outcome is an event, because `setupStatus`/`setupError` are not implemented                                                                                         |
| `environment`, `noEnv`, `visibility`, `org`, `teamId` | Ignored. Accounts, organizations and environments do not exist here (0003), so there is nothing for them to select                                                                                                   |
| `snapshots`, `monitoring`, `failFast`, `count`        | Ignored. There is no background snapshotting, no metrics store, no pre-warmed machine pool, and create is one sandbox per call                                                                                       |
| `hostedPorts`, `files`                                | Ignored, though they are _possible_: both need the sandbox to exist first and are one call away (`POST /host`, `PUT /files`). Documented in [api.md](../api.md#create-fields) rather than half-implemented at create |

Resume follows the same rule: `ttlSeconds`, `type` and `name` are applied, the rest accepted.

**The cost of this choice is real:** a client that sends `files` or `hostedPorts` gets a sandbox
without them and no error. That is why the fields are listed in `docs/api.md` as "accepted and
ignored" next to the ones that work, instead of being quietly swallowed by a permissive schema.

**The alternative — rejecting the tolerated fields — was measured and is worse.** It broke a client
doing exactly what its own schema allowed: `noEnv` and `visibility` returned
`400 invalid_query "unknown parameters"` for fields the client was entitled to send.

## Consequences

- A client can tell "not implemented here" from "wrong URL" from "broken", which is the whole point.
- Extensions add routes and fields; they never alter an existing one, so a client that ignores them is
  unaffected.
- We own a small divergence surface. It is tracked in `docs/api.md` beside the routes it touches, so it
  cannot quietly grow into "mostly works".
- The `501` messages are operator-facing documentation that cannot go stale in a wiki, because they
  ship with the response.

## Alternatives considered

- **Return 200 with an empty/placeholder body.** Rejected: teaches clients to trust a lie.
- **Implement `/ports` inside the sandbox record.** Rejected: bloats every sandbox response with
  per-port detail that most reads do not want.
