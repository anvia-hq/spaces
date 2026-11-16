# 0025 — Deploy as one process: the API serves the console

- **Status:** accepted
- **Date:** 2026-11-15

## Context

Deploying to a real KVM host (Debian 13, AMD-V, 16 cores, 31 GiB) exposed a gap. The API
served only `/api/v1` and `/health`; the console is a Vite build whose client uses **relative** `/api`
paths, so it must be served from the same origin as the API. Nothing in the repository served it.

The obvious answer is a reverse proxy. But this project had already been bitten by exactly the failure a
proxy introduces: `/health` was missing from the Vite proxy, so the console received a `200` full of
SPA HTML, `res.json()` threw, and the header confidently declared a healthy API unreachable. A deployment
recipe whose most likely misconfiguration is _the console lying about connectivity_ is a bad recipe.

## Decision

**Serve the built console from the API itself.** `SPACES_WEB_ROOT` points at `apps/web/dist`; Hono
serves static assets and an SPA fallback, registered last, and both step aside for `/api` and `/health`.

The deployment is then one systemd unit on the runner:

- `SPACES_MSB_HOST=local` — control plane and runner on the same machine, so a command costs 20–32 ms
  rather than an SSH round trip (0017).
- `SPACES_BIND=127.0.0.1`, with **`tailscale serve` terminating TLS** on 443 and proxying to it. The API
  executes arbitrary code on request; `ufw` (`INPUT DROP`) is the third layer (0022).
- `SPACES_PUBLIC_URL` set to the HTTPS MagicDNS origin, because signed download and preview URLs are
  absolute.
- `KillMode=process` in the unit.
- `scripts/deploy.sh` does the whole thing idempotently: install `bun` and `msb` if absent, gate on
  `msb doctor` reporting "Host setup is ready", sync, build, write `/etc/spaces/spaces.env` with a
  generated key **once**, install the unit, and refuse to report success until `/health` answers.

Two defects were fixed on the way, because the deployment made them visible:

- **`app.notFound` did not exist.** An unknown `/api` path returned Hono's plain-text `404 Not Found`,
  so a client parsing the error body got nothing — the one place the envelope still leaked (0005).
- **`/api` without a trailing slash** fell through to the SPA fallback and returned the console's HTML.

## Browser access: `tailscale serve` rather than a port on an interface

The first deployment bound the API to the tailnet address and served plain HTTP on `:8787`. That works
for `curl` and for the console's own fetch calls, but it is the wrong shape for a browser tool: a raw
`http://100.x.y.z:8787` origin has no certificate, no name, and no way to be pasted into a chat or a
bookmark without looking like a mistake. It also leaves a plaintext listener on the interface where a
user cannot tell whether the traffic is actually inside WireGuard.

So the deployment now:

1. binds the API to **loopback**, so the only listener on an interface is tailscaled;
2. runs `tailscale serve --bg --https=443 http://127.0.0.1:8787`, which provisions a **Let's Encrypt
   certificate for the MagicDNS name** and proxies to loopback;
3. sets `SPACES_PUBLIC_URL=https://<machine>.<tailnet>.ts.net` so signed URLs are minted on the origin
   the browser actually uses.

The result is `https://<machine>.<tailnet>.ts.net` with a trusted certificate, and it covers more than
the console: transfer URLs, port previews and snapshot downloads are all served by the API, so every
link the product hands out is HTTPS and clickable.

`deploy.sh` does this automatically when the tailnet has a MagicDNS name, keeps the mapping idempotent
on redeploy, and **re-asserts `SPACES_BIND` and `SPACES_PUBLIC_URL` in an existing env file** — otherwise
upgrading a plain-HTTP deployment would leave the old origin minting broken links.

A consequence: published guest ports still bind the host's loopback (0014), so the `sshEndpoint` a
sandbox reports is only reachable from the runner itself. The API used to warn about this only when
`SPACES_MSB_HOST` pointed elsewhere, which stopped being the right condition once both processes share a
machine — the warning is now keyed on `SPACES_PORT_BIND` and prints the exact `ssh -N -L` line.

## Consequences

- The misconfiguration class is gone by construction: there is no proxy to forget `/health`.
- One process to supervise, log and restart; systemd owns the lifecycle.
- **`KillMode=process` is load-bearing.** Verified empirically: a guest process kept appending to a file
  across a `systemctl restart spaces` (11 → 29 lines, sandbox still `ready`). With systemd's default
  `control-group`, the VMM processes are in the service cgroup and a routine deploy would destroy every
  running sandbox. This is the kind of default that looks harmless until the first upgrade.
- Static serving adds one `stat` per non-API request; API paths skip the handler explicitly, so the hot
  path is untouched.
- The SPA fallback checks paths instead of trusting route order, because answering a mistyped endpoint
  with `index.html` and a `200` is precisely the bug that made the console lie before.
- The deploy is **rsync from a checkout**, not a build artefact. That is fine for one operator pushing to
  one box, and it is not reproducible from a registry — an honest limitation rather than a hidden one.
- Secrets: `/etc/spaces/spaces.env` is `0600`, root-owned, and read by systemd _before_ dropping to the
  service user, so the API key is never readable by the process that executes guest code.
- TLS is delegated to `tailscale serve`: a real certificate, no renewal cron, no proxy config. Without
  a tailnet the deployment falls back to plain HTTP on an interface, which is documented rather than
  pretended away. Exposing this beyond the tailnet would need a different certificate story and a
  decision about who may run code.

## Alternatives considered

- **nginx or Caddy in front.** Rejected: another artefact to install and another place to get `/health`
  wrong, for capabilities (TLS termination, compression) that this deployment does not use yet.
- **Docker / docker-compose.** Rejected: `msb` needs `/dev/kvm` and per-host state in
  `~/.microsandbox`, so the container would be privileged and the state would be a bind mount. The
  isolation it buys is already provided by the microVMs.
- **Build the console in CI and ship `dist`.** Reasonable later; today the target machine has `bun`, so
  building there removes a moving part and a version-skew risk.
- **Bind `0.0.0.0` and rely on the firewall.** Rejected as the default: defence in depth costs one
  environment variable, and every published guest port still binds loopback (0014).
