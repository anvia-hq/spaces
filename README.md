# spaces

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)

**Hardware-isolated microVMs on hardware you control, behind an HTTP API.**

> **Under heavy development.** The API surface, storage layer and console all move quickly; expect
> breaking changes until this note goes away.

spaces gives you real virtual machines — not containers — and an API to create, use, snapshot and fork
them. Boot a sandbox in about 250 ms, run commands in it, read and write its files, publish a port, SSH
in, freeze the disk, clone it. From the bundled console, or from your own tooling over HTTP.

Every sandbox has its own kernel, so nothing inside it can see the host filesystem, the host processes
or another sandbox. And because it is a microVM rather than a VM you wait for, it is fast enough to
treat as a throwaway.

```
macOS · Apple Silicon (Hypervisor.framework)   Linux · KVM   Windows · WHP
```

---

## Why spaces

- **Isolation that holds.** A separate kernel per sandbox, not a shared namespace. Untrusted build
  scripts, generated code and AI agents run without access to your machine.
- **Fast enough to be disposable.** ~250 ms to a usable machine, 20–45 ms per command through the full
  API. Create one per task instead of reusing a long-lived box.
- **Yours, end to end.** It runs on the machine in front of you, or on one KVM box on your network —
  no account, no cloud dependency, no egress bill. Your code and your data stay on your infrastructure.
- **An API that is the product.** Everything the console does is a route with one error envelope and
  one auth model, so your own tooling is never a second-class client.
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

## Get started

- **macOS 12+** on Apple Silicon, **Linux** with VT-x/AMD-V enabled in firmware and `/dev/kvm`
  accessible, or **Windows 11** with Windows Hypervisor Platform.
- **[Bun](https://bun.sh) 1.1+**
- ~5 GB free disk for images

The microsandbox CLI (`msb`) needs no root and installs into your home directory. `msb doctor` tells you
whether the host is ready.

```bash
# 1. Install the microsandbox CLI (user-space, no root)
./scripts/install-msb.sh

# 2. Confirm the host can run microVMs
msb doctor

# 3. Install dependencies and start
bun install
bun run dev          # API on :8787, console on :5173
```

Open **http://localhost:5173** and create an account (sign-up is enabled by default; the console is
login-first). The ⌘ Key button in the header points the console at a different server.

Prefer the API? `sk_local_dev` is the operator key a fresh install accepts:

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
through the API are owned by that user. Common dev-server ports are mapped up front so publishing them
is instant; any other port needs one microVM restart, and the response says so. To have sshd, Docker or
anything else on every sandbox, set `SPACES_BOOTSTRAP` to a shell snippet that runs after boot.

## The console

The console covers everything the API does, one tab per job:

| Tab           |                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------- |
| **Terminal**  | Sync, streaming and background commands; live processes; full history with replayable output |
| **Files**     | Browse, read, edit and save, mkdir, download, delete                                         |
| **Ports**     | Publish a port, copy its URL, unpublish                                                      |
| **SSH**       | Authorize a key and copy the exact command to run                                            |
| **Snapshots** | Save under a name, browse the frozen files, download the workdir, delete                     |
| **Usage**     | Billable seconds, cost and multiplier over a selectable window                               |

Alongside the tabs, every sandbox shows its machine facts and the lifecycle timeline, newest first.

## Snapshots, forks and sharing

A snapshot is the **disk**, frozen under a name. It outlives the sandbox it came from, so you can stop
a machine, delete it, and still browse the files or start a new sandbox from that exact state. `fork`
does the same thing instantly as a copy-on-write child while the parent keeps running.

Snapshots deliberately do **not** preserve memory or running processes: a resumed sandbox boots rather
than unpauses, so nothing depends on state a stop discarded. Saved snapshots can be shared with a secret
code that is stored hashed and shown once — see
[decision 0011](docs/decision/0011-snapshots-are-disk-only.md) and
[decision 0019](docs/decision/0019-saved-snapshots-and-share-codes.md).

## Built in

- **Accounts and API keys.** People sign in; sandboxes belong to whoever made them. One owner per
  resource, scoped at the database layer ([0028](docs/decision/0028-accounts-and-api-keys.md)).
- **An audit log.** Every change, with actor, target, result and request id — append-only and readable
  in the console ([0031](docs/decision/0031-audit-log.md)).
- **Tracing without a vendor.** Every request and the database and driver work under it is a span in
  this server's own database ([0032](docs/decision/0032-tracing.md)).
- **Metering.** Billable machine-seconds and cost, derived from the lifecycle event log.

## API

The HTTP surface is spaces' own: base path `/api/v1`, bearer auth or the console's session cookie, one
error envelope, and `GET /health` at the root. Requests and responses are defined once in
`packages/shared`, and the server validates every route against those schemas.

- **[API reference](docs/api.md)** — every endpoint, grouped, with examples
- **[`packages/shared`](packages/shared)** — the zod schemas the server enforces, one file per domain

Routes for a capability this server does not have are absent or answer `501` with the reason, never a
fake success. Changes to the surface land with a decision record, not quietly.

## Deployment

One command, to any Linux host with KVM:

```bash
./scripts/deploy.sh homelab-rz
```

It installs `bun` and `msb` if they are missing, checks the host with `msb doctor`, syncs the code,
builds the console, writes `/etc/spaces/spaces.env` (generating an API key once and keeping it on later
runs), installs a systemd unit, and refuses to report success until `/health` answers. Re-running it
redeploys.

The API and the runner live on the same machine, in one process on one port: the API serves the built
console itself, listens on loopback, and `tailscale serve` terminates HTTPS in front of it. On a tailnet
the console becomes a real HTTPS URL. Restarting the service does not kill running sandboxes
(`KillMode=process`). Why the topology is shaped this way is
[decision 0025](docs/decision/0025-deploy-as-one-process.md); other targets and the full configuration
table are in [docs/configuration.md](docs/configuration.md).

## Development

Building the API, the console or the guest image, changing the schema, running the tests (including the
opt-in guest tests): see **[DEVELOPMENT.md](DEVELOPMENT.md)**.

## License

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE) for attribution.

A hosted version is available at [anvia.dev](https://anvia.dev), and commercial support and enterprise
features are available at [hello@anvia.dev](mailto:hello@anvia.dev).

## Trademarks

"Spaces" and the Anvia name and logos are trademarks of Anvia. The Apache License does not grant
permission to use them: forks must use a different name and branding.
