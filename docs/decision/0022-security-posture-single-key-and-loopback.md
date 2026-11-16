# 0022 — One bearer key, loopback by default, tokens only where a browser needs them

- **Status:** accepted
- **Date:** 2026-11-15

## Context

This is a single-operator tool that runs sandboxes — arbitrary code — and exposes file access, command
execution and port proxying. The security model has to be stated, not implied by whatever defaults
happened to be typed.

## Decision

- **One bearer key.** `SPACES_API_KEY` (default `sk_local_dev` for development), required on every
  `/api/v1` route. It is compared with a plain string equality, not a constant-time compare: the
  threat model is a single operator over a trusted link, and a timing oracle against a 128-bit
  shared secret is not the weakest part of a service that executes arbitrary code on request.
- **Two exemptions, each with its own credential:**
  - `/_transfer/*` — signed transfer URLs (0010), bound to method, sandbox, path and expiry.
  - `/_preview/*` — hosted-port previews (0014), bound to sandbox and port, 24 h expiry, and only
    checked when the port is not explicitly `public`.
- **Published ports bind to loopback** (`SPACES_PORT_BIND=127.0.0.1`), so the only way in is through the
  API proxy. Reaching them requires opting into `0.0.0.0`.
- **Guests reach the network but not the host.** Per-sandbox `/30` subnets, no host filesystem, no host
  process visibility.
- **Secrets are hashed at rest**: share codes (0019) and nothing else needs to be.

## Consequences

- The blast radius of the API key is everything, which matches the deployment model: one operator, one
  machine. It is not suitable for multi-tenant exposure, and the README says so.
- A browser can open a preview URL without an extension or a header, because the token is in the query
  string. Tokens expire and are path-scoped, so a leaked preview URL dies on its own.
- Loopback binding means a remote `msb` host needs an SSH forward (0017) — the price of not exposing
  ports by default.
- The development default is a known key. Forking this for anything shared requires setting
  `SPACES_API_KEY`, which the README calls out in deployment.

## Alternatives considered

- **Per-user keys or sessions.** Rejected: no users, and it would imply multi-tenancy this does not have.
- **Bind published ports on all interfaces.** Rejected as a default; available as a setting.
- **Cookie auth for the console.** Rejected: one key, sent as a header, keeps the API and the UI on the
  same mechanism.
