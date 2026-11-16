# spaces

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)

**Hardware-isolated microVMs on hardware you control, behind an HTTP API.**

> **Under heavy development.** The API surface, storage layer and console all move quickly; expect
> breaking changes until this note goes away.

spaces runs real virtual machines — not containers — and gives you an API to create, use, snapshot
and fork them. Boot a sandbox in about 250 ms, run commands in it, read and write its files, publish
a port, SSH in, freeze the disk, clone it. From the included web console or from your own tooling
over HTTP.

Because each sandbox has its own kernel, nothing inside it can see the host filesystem, the host
processes, or another sandbox — and because it is a microVM, it is fast enough to treat as a
throwaway.

```
macOS · Apple Silicon (Hypervisor.framework)   Linux · KVM   Windows · WHP
```

---

## Why this exists

- **Isolation that holds.** A separate kernel per sandbox, not a shared namespace. Untrusted build
  scripts, generated code and AI agents run without access to your machine.
- **Fast enough to be disposable.** ~250 ms to a usable machine, 20–45 ms per command through the
  full API. Create one per task instead of reusing a long-lived box.
- **No account, no cloud, no egress bill.** It runs on the machine in front of you, or on one KVM box
  on your network. Your code and your data never leave your infrastructure.
- **An API that is the product.** Every capability in the console is a route, with one error envelope
  and one auth model, so your own tooling is never a second-class client.
- **Everything a sandbox needs.** Networking and package installs out of the box, published ports,
  SSH access, Docker, durable snapshots, and copy-on-write forks.

## What you can do

|                |                                                                                                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sandboxes**  | Create, stop, resume, fork, recover, delete. Idempotent creates, TTL auto-stop, labels, lifecycle events.                                                                    |
| **Commands**   | Run synchronously, stream output as it happens, or start a background process. Poll it by byte offset, list live processes, kill the group, replay any command's stored log. |
| **Files**      | Read, write, list, stat, move, mkdir, chmod, glob, content search, bulk text replace, and signed upload/download URLs for large payloads.                                    |
| **Networking** | Every sandbox boots with DNS and egress. Publish a guest port and get a URL the API proxies, so it opens in a browser without a token header.                                |
| **Access**     | Authorize a public key and get a working `ssh` command, endpoint and host key.                                                                                               |
| **Snapshots**  | Freeze a disk under a name. Browse its files without booting anything, download it as a tar, share it with a code, delete it.                                                |
| **Metering**   | Billable machine-seconds and cost per sandbox, with the machine-type multiplier applied.                                                                                     |

## Requirements

- **macOS 12+** on Apple Silicon, **Linux** with VT-x/AMD-V enabled in firmware and `/dev/kvm`
  accessible, or **Windows 11** with Windows Hypervisor Platform.
- **[Bun](https://bun.sh) 1.1+**
- ~5 GB free disk for images

The `msb` CLI needs no root and installs into your home directory. `msb doctor` tells you whether the
host is ready.

## Quickstart

```bash
# 1. Install the microsandbox CLI (user-space, no root)
./scripts/install-msb.sh

# 2. Confirm the host can run microVMs
msb doctor

# 3. Install dependencies and start
bun install
bun run dev          # API on :8787, console on :5173
```

Open **http://localhost:5173** and create a sandbox. The console signs in with the development key
(`sk_local_dev`); the ⌘ Key button in the header points it at a different server.

Prefer the API:

```bash
K='Authorization: Bearer sk_local_dev'
J='content-type: application/json'

# create a 2 vCPU / 4 GiB sandbox that auto-stops after 15 minutes
curl -s -H "$K" -H "$J" -X POST localhost:8787/api/v1/sandboxes \
  -d '{"type":"small","ttlSeconds":900}'

# run something in it
curl -s -H "$K" -H "$J" -X POST localhost:8787/api/v1/sandboxes/bx_xxx/commands \
  -d '{"command":"uname -a"}'
```

Available machine types: `small` (2 vCPU / 4 GiB), `default` (4 / 8), `large` (8 / 16),
`xlarge` (16 / 32).

## The console

`bun run dev:web` serves a React console covering everything the API does, one tab per job:

| Tab           |                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------- |
| **Terminal**  | Sync, streaming and background commands; live processes; full history with replayable output |
| **Files**     | Browse, read, edit and save, mkdir, download, delete                                         |
| **Ports**     | Publish a port, copy its URL, unpublish                                                      |
| **SSH**       | Authorize a key and copy the exact command to run                                            |
| **Snapshots** | Save under a name, browse the frozen files, download the workdir, delete                     |
| **Usage**     | Billable seconds, cost and multiplier over a selectable window                               |

Alongside the tabs, every sandbox shows its machine facts and the lifecycle timeline, newest first. The
console is built from shadcn/ui primitives and the free ReUI set, installed as source under
`apps/web/src/components/` — see [decision 0026](docs/decision/0026-console-on-shadcn-and-reui.md).
Feature code is one module per job under `apps/web/src/modules/`, and the API is one module per domain
under `apps/api/src/modules/` — see [decision 0027](docs/decision/0027-module-layout.md) and
[AGENTS.md](AGENTS.md).

## Accounts

The console is **login-first**: nothing renders until you sign in. Create an account (email and
password, Better Auth) and **API keys** issues keys that act as that account. Sandboxes and snapshots belong to whoever made
them — a key sees its own account's resources and nothing else, and someone else's id answers `404`.

One credential predates all of this: `SPACES_API_KEY`, the operator key. It sees every sandbox,
including those owned by accounts, and it is what a fresh install and existing clients (Aven sends one)
use. `curl -H "Authorization: Bearer $SPACES_API_KEY" $SPACES_PUBLIC_URL/api/v1/sandboxes` still works
exactly as before.

The console is **session-only**: create an account, even on `localhost` (sign-up is enabled by
default). Nothing is seeded automatically and no bearer key is sent — a console that invents a
credential is how "invalid API key" appeared before anyone typed one. The operator key stays available
to API clients through `SPACES_API_KEY`; it is not a way into the console. To try a real account locally, sign up — a session takes
precedence over the key that the console sends alongside it — or paste a key in the dialog. Set
`SPACES_API_KEY=` empty to turn the operator key off entirely and require sessions or user keys.

## Audit log

Every change is recorded: who (operator key, a person, or the key they used), what (`sandbox.create`,
`snapshot.save`, `api_key.revoke`, `auth.sign_in`, …), on what, with what result, from where, with the
request id — append-only and readable at **Audit** in the console or `GET /api/v1/audit-log`. A user
sees their own entries; the operator key sees all. Why it is built this way is
[decision 0031](docs/decision/0031-audit-log.md).

## Traces

Every request, and the database and driver work under it, is a span — timed, parented, and stored in
this server's own database, so `Traces` in the console answers "why was that slow" without a collector.
The strip above the list shows request rate, error rate, p50/p95 latency and how long provisioning,
stops and snapshots take. Set `SPACES_OTLP_ENDPOINT` to ship the same spans anywhere; retention is
`SPACES_TRACE_RETENTION_DAYS` (default 7). See [decision 0032](docs/decision/0032-tracing.md).

## API

The HTTP surface is spaces' own. Base path `/api/v1`, bearer auth (or the console's session cookie),
and `GET /health` at the root. Requests and responses are defined once in `packages/shared`, and the
server validates every route against those schemas, so the reference and the behaviour agree by
construction. Errors share one envelope on every route.

Routes for a capability this server does not have (a display server, an AI agent, organizations) are
absent or answer `501` with the reason, never a fake success. Changes to the surface are versioned
and recorded in [docs/decision/](./docs/decision/README.md), not slipped in.

- **[API reference](./docs/api.md)** — every endpoint, grouped, with examples
- **[`packages/shared`](./packages/shared)** — the zod schemas the server enforces, one file per domain

## Sandboxes that behave like machines

Guests boot with a **network device**, so ordinary things work without host configuration:

```bash
# package installs
{"command": "apk add --no-cache python3"}

# publish the app running inside
POST /sandboxes/{id}/host  {"port": 3000}
# -> { "url": "http://…/api/v1/_preview/bx_…/3000?_token=…" }

# SSH in
POST /sandboxes/{id}/sshkey  {"key": "ssh-ed25519 AAAA…"}
# -> { "sshUser": "user", "sshEndpoint": "localhost:22008", "hostKey": "ssh-ed25519 AAAA…" }
```

Commands run as **`user`** (uid/gid 1000, `HOME=/home/user`, passwordless `sudo`), and files written
through the API are owned by that user. The account is created on first boot.

Common dev-server ports are mapped up front so publishing them is instant; any other port needs one
microVM restart, and the response says so. Docker runs inside a sandbox once installed — the guest
setup is documented in [internals](./docs/internals.md#host-notes). To have sshd, Docker or anything
else on every sandbox, set `SPACES_BOOTSTRAP` to a shell snippet that runs once after boot.

## Guest image

The default `alpine` image is tiny and boots in ~250 ms, but it has no glibc, no `curl`, no `git` and
no `procps` — so `GET /processes` degrades to busybox `ps`, and anything expecting a normal Linux box
needs `apk add` on every create. For a session that starts useful, use the ready image:

```bash
docker build -t spaces/guest:ubuntu -f deploy/guest/Dockerfile .
docker save spaces/guest:ubuntu | msb load -t spaces/guest:ubuntu
SPACES_MSB_IMAGE=spaces/guest:ubuntu ./scripts/deploy.sh <host>
```

It is `ubuntu:24.04` plus `ca-certificates curl git tar procps sudo jq unzip`, with the `user` account
already in place. No registry needed: locally built images are loaded into msb's cache. Measured on a
16-core AMD host: **ready in ~0.6 s**, `curl`, `git`, `ps` and `pgrep` present on first command.

Without Docker, the equivalent is one environment variable per deployment — but it costs the install
time on **every** create:

```bash
SPACES_BOOTSTRAP='apt-get update -qq && apt-get install -y -qq ca-certificates curl git tar procps sudo'
```

The `user` account is not in that snippet: the API creates and owns it on every boot regardless.

`SPACES_BOOTSTRAP` runs as **root** (it installs packages); `setupScript` from the create request runs
as `user`.

## Networking

Guests get a network device with DNS and public egress by default (`SPACES_NET=public`). That profile
permits public addresses and **denies private ones**, so a guest cannot reach a database on your LAN,
a service on another tailnet node, or `192.168.*` at all.

Two ways out, narrowest first:

```bash
# allow exactly one host (or one host and port) — preferred
SPACES_NET_RULES='allow@192.168.1.50,allow@100.101.102.103:tcp:5432'

# or turn filtering off entirely
SPACES_NET=all
```

Rules take precedence over the profile and use msb's grammar
`<action>[:<direction>]@<target>[:<proto>[:<ports>]]`; targets can be IPs/CIDRs, domains, domain
suffixes (`*.example.com`), groups (`public`, `private`, `multicast`) and `dns`. `SPACES_NET=none`
(equivalently `--no-net`) air-gaps a guest completely.

## Snapshots and forks

A snapshot is the **disk**, frozen under a name. It outlives the sandbox it came from, so you can
stop a machine, delete it, and still browse the files or start a new sandbox from that exact state.
`fork` does the same thing instantly as a copy-on-write child while the parent keeps running.

Snapshots deliberately do **not** preserve memory or running processes: a resumed sandbox boots rather
than unpauses, so nothing depends on state a stop discarded. Memory snapshots are possible and
measured, but they stay behind their own future endpoint — see
[decision 0011](docs/decision/0011-snapshots-are-disk-only.md).

## Deployment

One command, to any Linux host with KVM:

```bash
./scripts/deploy.sh homelab-rz
```

It installs `bun` and `msb` if they are missing, checks the host with `msb doctor`, syncs the code,
builds the console, writes `/etc/spaces/spaces.env` (generating an API key once and keeping it on later
runs), installs a systemd unit, and refuses to report success until `/health` answers. Re-running it
redeploys.

On a tailnet it also configures `tailscale serve` for you, so the console is a real HTTPS URL:

```
https://homelab-rz.tail9a7b40.ts.net
```

Verified on Debian 13 / AMD-V / 16 cores: a microVM is ready in ~1 s and a command round-trips in
**32–58 ms** over Tailscale, with a Let's Encrypt certificate.

### What that topology is

**Control plane and runner on the same machine.** The API drives `msb` locally, so nothing crosses an
SSH hop. Splitting them is possible — set `SPACES_MSB_HOST` to another host — but a sandbox is bound to
the machine holding its disk, so a second host is a second pool, not extra capacity for the first.

**One process, one port.** The API serves the built console itself (`SPACES_WEB_ROOT`). This is not
tidiness: a reverse proxy that forwards `/api` but forgets `/health` makes the console report the API
as unreachable while it is answering normally.

**TLS by `tailscale serve`, bound to loopback.** The API listens on `127.0.0.1` only; `tailscale serve`
terminates HTTPS on 443 using a certificate for the MagicDNS name and proxies to it. So there is no
plaintext listener on any interface, the browser gets a trusted certificate, and `ufw` (`INPUT DROP`)
is a third layer. The API executes code on request, so it must not be reachable from the LAN.

**`SPACES_PUBLIC_URL` must match what the browser sees** (`https://…ts.net`). Signed download and
preview URLs are absolute, so a stale `http://` origin means every link points at the wrong scheme.

**`KillMode=process`** — restarting or upgrading the API does not kill running sandboxes. With
systemd's default the VMM processes are in the service's control group and a routine deploy would
destroy every guest. Verified: a guest process kept running across a service restart.

### Other targets

- **Locally** — `bun run dev`. The fastest path; `msb` runs on your machine.
- **A separate hypervisor** — `./scripts/install-msb.sh dev-box`, then `SPACES_MSB_HOST=dev-box` when
  starting the API. Published ports bind to loopback there and are proxied over an SSH forward.
- **Behind a reverse proxy** — serve the console with the API (`SPACES_WEB_ROOT`), or build
  `apps/web/dist` and serve it yourself; either way proxy **both** `/api` and `/health`. Set
  `SPACES_API_KEY` to something other than the default and `SPACES_PUBLIC_URL` to the public origin so
  signed links are absolute.

### What it does not do

No certificate handling of its own — `tailscale serve` does that, and without a tailnet you get plain
HTTP. No backups, and no log aggregation. Durability lives in
two places on the _runner_: `~/spaces/data/spaces.db` (metadata) and `~/.microsandbox` (the disks).
Backing up only the database gives you a list of sandboxes that no longer exist.

## Configuration

Everything has a working default for local development.

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

## Project layout

```
apps/
  api/      Hono + Bun. REST surface over the driver, Drizzle-backed.
  web/      React + Vite + TanStack Router + Tailwind console (shadcn/ui + ReUI source).
packages/
  shared/   Zod contracts, error envelope, machine sizes.
  db/       Drizzle schema, Postgres migrations.
docs/
  api.md              Endpoint reference
  internals.md        How files, ports, SSH and commands actually work
  decision/           Why the architecture is what it is (33 decision records)
deploy/
  spaces.service      systemd unit (KillMode=process keeps sandboxes alive on restart)
  spaces.env.example  Runtime configuration installed to /etc/spaces/spaces.env
scripts/
  deploy.sh           Deploy to a KVM host over SSH: install, build, systemd, verify
  install-msb.sh      Install the msb CLI locally or on a remote host
```

## Development

```bash
bun run dev:api     # API with watch
bun run dev:web     # console with HMR
bun run typecheck   # all workspaces
bun run build       # production build
bun run lint        # oxlint (aven's rules)
bun run format      # oxfmt
bun run test        # contract tests against a real Postgres (mock driver)
```

A database is needed for development. One line with a local Postgres:

```bash
psql -c 'create database spaces'            # once
bun run test                                # uses spaces_test; create it too
psql -c 'create database spaces_test'
```

`SPACES_DATABASE_URL` overrides both (`postgres://user:pass@host:5432/db`). Migrations are applied
when the API boots, so `bun run dev` on a fresh database is enough.

Changing the database schema:

```bash
SPACES_DATABASE_URL=postgres://localhost:5432/spaces bun run --cwd packages/db generate   # new migration from schema.ts
```

Migrations apply automatically at boot.

Guest-runtime tests need a hypervisor and are opt-in — they run against `msb`, locally or over SSH:

```bash
SPACES_IT=1 bun run test:guest                                     # this machine
SPACES_IT=1 SPACES_MSB_HOST=box bun run test:guest                 # another host
SPACES_IT=1 SPACES_MSB_HOST=box SPACES_MSB_IMAGE=spaces/guest:ubuntu SPACES_IT_READY=1 bun run test:guest
```

They cover what a mock cannot: commands running as `user`, file ownership, the detached-command
timeout and its `setsid` escape, and the tools the ready image ships.

Before changing the runtime, read [docs/internals.md](./docs/internals.md) for how the mechanisms work,
and [docs/decision/](./docs/decision/README.md) for why they are that way. The decision records are
short and specific: why file operations ride on `exec`, why background commands need `setsid`, why path
traversal is blocked twice, why snapshots are disk-only, and why a remote `msb` needs an SSH forward.

## License

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE) for attribution.

A hosted version is available at [anvia.dev](https://anvia.dev), and commercial support and enterprise
features are available at [hello@anvia.dev](mailto:hello@anvia.dev).

## Trademarks

"Spaces" and the Anvia name and logos are trademarks of Anvia. The Apache License does not grant
permission to use them: forks must use a different name and branding.
