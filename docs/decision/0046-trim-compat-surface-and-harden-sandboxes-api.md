# 0046 — Trim SaaS compatibility leftovers and harden the sandbox API

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Spaces originally mirrored an external hosted sandbox API so early clients could run without changes
(decisions [0002](./0002-the-api-is-its-own-contract.md) and
[0021](./0021-extensions-and-honest-refusals.md)). As Spaces grew into a self-hosted microVM
cluster for one trusted team (decisions [0042](./0042-control-plane-and-runtimes.md) and
[0044](./0044-a-cluster-is-one-team.md)), that compatibility layer became dead weight:

- Nine `501` refusal routes (`/desktop`, `/prompt`, `/steer`, `/interrupt`, `/conversations`,
  `/prompts/{id}`, `/ai-access`, `/share`, `/unshare`) and an empty `/ai-usage` meter existed only
  for capabilities a self-hosted microVM runtime does not run.
- `CreateSandboxRequest` and `ResumeRequest` accepted and silently ignored SaaS-only fields (`org`,
  `teamId`, `visibility`, `environment`, `noEnv`, `snapshots`, `monitoring`, `failFast`, `count`)
  and reserved external product environment variable names.
- `/named-snapshots` duplicated `/saved-snapshots`, and `/saved-snapshots/{name}/shares` minted
  share codes that nothing in a single-team cluster could redeem (decision
  [0038](./0038-create-from-a-saved-snapshot.md)).
- Meanwhile, real sandbox API ergonomics had quiet gaps: `GET /sandboxes` validated `limit`,
  `cursor` and `sort` without applying them; `Idempotency-Key` lived only in an in-memory `Map`
  that vanished on restart; `POST /resume` dropped `env`; `POST /fork` wiped the parent's `env`
  instead of inheriting it; and `PATCH /sandboxes/{id}` rejected `labels: null`.

## Decision

**Drop the SaaS compatibility surface and make every accepted field real.**

1. **Remove dead routes:** Delete `modules/sandboxes/refusals.ts`, `GET /sandboxes/{id}/ai-usage`,
   `/named-snapshots[/{name}]`, and `/saved-snapshots/{name}/shares[/{shareId}]` (and its console
   panel). Unknown paths return the standard JSON `404`.
2. **Tighten sandbox schemas:** Remove the ignored SaaS fields (`org`, `teamId`, `visibility`,
   `environment`, `noEnv`, `snapshots`, `monitoring`, `failFast`, `count`), legacy `"infinite"` on
   `ttlSeconds` (`null` disables auto-stop), external reserved env keys, and
   `desktopAvailable`/`desktopUrl` from `Sandbox`.
3. **Wire list pagination and filtering:** `GET /sandboxes` honours `limit` (1–200), keyset
   `cursor` (`<timestamp>|<id>`), `sort` (`createdAt:desc`, `createdAt:asc`, `updatedAt:desc`) and
   `stoppedBefore`, returning `nextCursor: string | null`.
4. **Persist `Idempotency-Key` in Postgres:** Store keys in `idempotency_keys` with a 24-hour TTL
   swept on the existing maintenance timer, so retries survive control-plane restarts.
5. **Fix `resume`, `fork`, and `PATCH` semantics:**
   - `POST /sandboxes/{id}/resume` persists and applies `env` when sent.
   - `POST /sandboxes/{id}/fork` inherits the source sandbox's `env` unless `env` is passed.
   - `PATCH /sandboxes/{id}` accepts `labels: null` to clear all labels.

## Consequences

- Every route and field in the sandbox surface does what it says; callers no longer hit silent
  no-ops or stub endpoints.
- Existing clients using core sandbox lifecycle, commands, files, ports, SSH, and saved snapshots
  continue working unchanged, with durable idempotency across restarts.
- The `snapshot_shares` table stays in Postgres so upgrading deployments need no destructive table
  drop.
