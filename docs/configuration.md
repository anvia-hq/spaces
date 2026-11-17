# Configuration

Every setting has a working default for local development. This file covers the environment, guest
networking and deployment targets; the architecture behind them is in
[docs/decision/](decision/README.md) and [docs/internals.md](internals.md).

## Variables

| Variable                           | Default                                   |                                                                     |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| `PORT`                             | `8787`                                    | API port                                                            |
| `SPACES_BIND`                      | `0.0.0.0`                                 | Interface to bind; set the tailnet IP or `127.0.0.1` behind a proxy |
| `SPACES_WEB_ROOT`                  | —                                         | Directory of the built console; empty disables static serving       |
| `SPACES_API_KEY`                   | `sk_local_dev`                            | Bearer key clients must present                                     |
| `SPACES_MSB_HOST`                  | `local`                                   | `local`, or an SSH host running microsandbox                        |
| `SPACES_MSB_IMAGE`                 | `alpine`                                  | OCI image for new sandboxes                                         |
| `SPACES_DRIVER`                    | `microsandbox`                            | `microsandbox` or `mock` (no hypervisor, for CI)                    |
| `SPACES_DATABASE_URL`              | `postgres://localhost:5432/spaces`        | Postgres connection string                                          |
| `SPACES_TRACES`                    | `on`                                      | `off` records no spans                                              |
| `SPACES_TRACE_RETENTION_DAYS`      | `7`                                       | Spans older than this are swept (`0` keeps them)                    |
| `SPACES_OTLP_ENDPOINT`             | —                                         | Also export spans to an OTLP collector                              |
| `SPACES_AUTH_SECRET`               | dev value                                 | Better Auth signing secret; set it in any real deployment           |
| `SPACES_AUTH_URL`                  | request origin                            | Public origin of the API, for cookies and the origin check          |
| `SPACES_GITHUB_CLIENT_ID`          | —                                         | GitHub OAuth app client id; unset disables GitHub sign-in           |
| `SPACES_GITHUB_CLIENT_SECRET`      | —                                         | GitHub OAuth app secret; both halves or neither                     |
| `SPACES_MAX_SANDBOXES`             | `32`                                      | Admission limit                                                     |
| `SPACES_NET`                       | `public`                                  | Guest network: `public`, `private`, `host`, `all`, `none`           |
| `SPACES_NET_RULES`                 | —                                         | `msb --net-rule` entries, e.g. `allow@example.com:tcp:443`          |
| `SPACES_PREPUBLISH_PORTS`          | `3000,3001,4000,5000,5173,8000,8080,8888` | Ports mapped at create so publishing is instant                     |
| `SPACES_PORT_RANGE_START` / `_END` | `22000` / `22999`                         | Host ports used for publishing (`START=0` disables)                 |
| `SPACES_PORT_BIND`                 | `127.0.0.1`                               | Address a published port binds to                                   |
| `SPACES_BOOTSTRAP`                 | —                                         | Shell snippet run once after boot                                   |
| `SPACES_SIGNING_KEY`               | derived from API key                      | HMAC key for signed URLs                                            |
| `SPACES_PUBLIC_URL`                | request origin                            | Origin used when minting signed URLs                                |
| `SPACES_TRANSFER_MAX`              | `104857600`                               | Ceiling for one signed transfer                                     |

`SPACES_PUBLIC_URL` must match what the browser sees (`https://…ts.net`): signed download and preview
URLs are absolute, so a stale `http://` origin points every link at the wrong scheme.

`SPACES_GITHUB_CLIENT_ID` and `SPACES_GITHUB_CLIENT_SECRET` register GitHub as a sign-in provider only
when **both** are set; either one alone, or both empty, leaves it out and email + password is the only
way in. The OAuth app's authorization callback URL is `SPACES_AUTH_URL` + `/api/auth/callback/github`.
See [DEVELOPMENT.md](../DEVELOPMENT.md#github-sign-in) and
decision [0036](decision/0036-github-login-from-the-environment.md).

`SPACES_BOOTSTRAP` runs as **root** in the guest (it installs packages). To bake tools in instead, build
a guest image — see [DEVELOPMENT.md](../DEVELOPMENT.md#guest-image).

## Networking

Guests get a network device with DNS and public egress by default (`SPACES_NET=public`). That profile
permits public addresses and **denies private ones**, so a guest cannot reach a database on your LAN, a
service on another tailnet node, or `192.168.*` at all.

Two ways out, narrowest first:

```bash
# allow exactly one host (or one host and port) — preferred
SPACES_NET_RULES='allow@192.168.1.50,allow@100.101.102.103:tcp:5432'

# or turn filtering off entirely
SPACES_NET=all
```

Rules take precedence over the profile and use msb's grammar
`<action>[:<direction>]@<target>[:<proto>[:<ports>]]`; targets can be IPs/CIDRs, domains, domain suffixes
(`*.example.com`), groups (`public`, `private`, `multicast`) and `dns`. `SPACES_NET=none`
(equivalently `--no-net`) air-gaps a guest completely.

## Deployment targets

- **Locally** — `bun run dev`. The fastest path; `msb` runs on your machine.
- **One KVM host** — `./scripts/deploy.sh <host>`. The API, the console and the guests share the machine;
  `tailscale serve` provides HTTPS bound to loopback. See [decision 0025](decision/0025-deploy-as-one-process.md).
- **A separate hypervisor** — `./scripts/install-msb.sh dev-box`, then `SPACES_MSB_HOST=dev-box` when
  starting the API. Published ports bind to loopback there and are proxied over an SSH forward.
- **Behind a reverse proxy** — serve the console with the API (`SPACES_WEB_ROOT`), or build
  `apps/web/dist` and serve it yourself; either way proxy **both** `/api` and `/health`. Set
  `SPACES_API_KEY` to something other than the default and `SPACES_PUBLIC_URL` to the public origin so
  signed links are absolute.

The API executes code on request and holds one operator credential per deployment: it is not suitable
for multi-tenant exposure, and it must not be reachable from an untrusted network
([decision 0022](decision/0022-security-posture-single-key-and-loopback.md)).

Backups: durability lives in two places on the runner — the Postgres database (metadata) and
`~/.microsandbox` (the disks). Backing up only the database gives you a list of sandboxes that no longer
exist.
