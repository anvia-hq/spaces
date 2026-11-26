# 0048 — Per-sandbox network egress policy

- **Status:** accepted
- **Date:** 2026-11-26

## Context

Spaces previously configured guest egress only at the runtime level (`SPACES_NET` and
`SPACES_NET_RULES`, decision [0013](./0013-guest-networking-on-by-default.md)). Every sandbox on a
runtime inherited the exact same network rules, which prevented a caller from air-gapping an
untrusted build (`deny`) or restricting an AI agent to specific domains (`allow: ["github.com",
"registry.npmjs.org"]`) without running a separate runtime.

`msb create` and `msb restore` natively accept per-sandbox `--no-net`, `--net`, `--net-default`,
and `--net-rule` flags with domain, wildcard (`*.example.com`), IP/CIDR, and semantic `dns`
targets. However, `msb modify` does not currently support mutating network rules on an already
created sandbox, and `msb fork` inherits its parent's network configuration.

## Decision

1. **Per-sandbox `network` policy on create:**
   - `POST /sandboxes` accepts an optional `network: { mode, allow? }`:
     - `default`: follow the runtime's configured `SPACES_NET` / `SPACES_NET_RULES`.
     - `open`: public internet allowed, private/LAN denied (`--net public`).
     - `deny`: no outbound network (`--no-net`).
     - `allow`: deny by default (`--no-net`) and allow only the 1–100 listed entries. Domain and
       wildcard (`*.example.com`) entries allow TCP 443 and TCP 80 and automatically add
       `allow@dns`; public IP/CIDR entries allow traffic to that destination.
   - Private, loopback, link-local, CGNAT/tailnet (`100.64.0.0/10`), and multicast IPs/CIDRs are
     rejected in per-sandbox `allow` lists so a sandbox caller cannot weaken a runtime's LAN
     isolation.
2. **Persistence and read route:**
   - The policy is stored in `sandboxes.network_policy`, surfaced on `Sandbox.network`, and
     readable at `GET /sandboxes/{id}/network`.
   - `POST /sandboxes/{id}/fork` inherits the parent sandbox's policy and answers
     `409 network_policy_unsupported` if a caller requests a different policy on fork (use a saved
     snapshot restore to boot a disk under a new policy).
3. **No live `PUT /sandboxes/{id}/network` yet:**
   - Because `msb modify` does not support live network rule replacement, `PUT` is intentionally
     omitted rather than silently ignored or faked. When `msb modify` gains network flags, `PUT`
     can be added cleanly without changing the policy schema.

## Consequences

- Callers and the console can air-gap or allowlist individual sandboxes on a shared runtime.
- Runtimes stay protected from private-LAN egress bypasses by construction.
- Existing callers omitting `network` keep the runtime's default behaviour unchanged.
