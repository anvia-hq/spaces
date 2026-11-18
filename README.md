# spaces

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue.svg)](LICENSE)

**Hardware-isolated microVMs on hardware you control, behind an HTTP API.**

> **Under heavy development.** Expect breaking changes until this note goes away.

spaces gives you real virtual machines — not containers — and an API to create, use, snapshot and fork
them: boot one in about 250 ms, run commands in it, read and write files, publish a port, SSH in, freeze
the disk, clone it. From the bundled console or your own tooling.

One deployment is a **cluster**: a control plane holding the API, the database and the console, and one
or more machines that run the sandboxes. One machine is a cluster of one; more capacity is one command
on the next machine, and nothing changes for the client.

Every sandbox has its own kernel, so nothing inside it can see the host filesystem, the host processes
or another sandbox — and it is fast enough to throw away after one task.

```
macOS · Apple Silicon (Hypervisor.framework)   Linux · KVM
```

---

## Why spaces

- **Isolation that holds.** A separate kernel per sandbox, not a shared namespace: untrusted build
  scripts, generated code and AI agents run without access to your machine.
- **Fast enough to be disposable.** ~250 ms to a usable machine, 20–45 ms per command through the full
  API. One sandbox per task instead of one long-lived box.
- **Yours, end to end.** Your machines, on your network. No account, no cloud dependency, no egress bill.
- **A cluster, not one box.** A control plane schedules each sandbox onto a runtime that has room; a
  disk never leaves the machine that holds it, so stop and resume cost nothing and never move data.
- **Everything a sandbox needs.** Networking and package installs out of the box, published ports, SSH,
  Docker, durable snapshots, copy-on-write forks.

## What you can do

|                |                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Sandboxes**  | Create, stop, resume, fork, recover, delete. Idempotent creates, TTL auto-stop, labels, lifecycle events.                 |
| **Commands**   | Synchronous, streaming or background; poll by byte offset, list live processes, kill the group, replay any command's log. |
| **Files**      | Read, write, list, stat, move, mkdir, chmod, glob, search, replace, plus signed upload/download URLs for large payloads.  |
| **Networking** | DNS and egress by default. Publish a guest port and get a proxied URL that opens in a browser without a token header.     |
| **Access**     | Authorize a public key and get a working `ssh` command, endpoint and host key.                                            |
| **Snapshots**  | Freeze a disk under a name, browse its files without booting anything, download it as a tar, share it with a code.        |

## Get started

Requirements: macOS 12+ on Apple Silicon, or Linux with `/dev/kvm`; **Bun 1.1+**;
~5 GB of disk. The `msb` CLI installs without root and never needs it.

```bash
./scripts/install-msb.sh   # microsandbox CLI, user-space
msb doctor                 # can this host run microVMs?
bun install
bun run dev                # API on :8787, console on :5173
```

Open **http://localhost:5173** and create an account — the console is login-first and sign-up is enabled
by default. GitHub sign-in is one environment pair away (`SPACES_GITHUB_CLIENT_ID`,
`SPACES_GITHUB_CLIENT_SECRET`; see [DEVELOPMENT.md](DEVELOPMENT.md#github-sign-in)). For API clients,
`sk_local_dev` is the operator key a fresh install accepts:

```bash
curl -s -X POST localhost:8787/api/v1/sandboxes \
  -H 'Authorization: Bearer sk_local_dev' -H 'content-type: application/json' \
  -d '{"type":"small","ttlSeconds":900}'
```

Machine types: `small` 2 vCPU / 4 GiB, `default` 4 / 8, `large` 8 / 16, `xlarge` 16 / 32. Commands run
as `user` (uid/gid 1000, passwordless `sudo`); to preinstall sshd, Docker or anything else on every
sandbox, set `SPACES_BOOTSTRAP` — see [docs/configuration.md](docs/configuration.md).

## Console, API, accounts

The console covers everything the API does — terminal, files, ports, SSH, snapshots, usage — plus the
lifecycle timeline for each sandbox. One deployment is one team, so everyone who signs in sees every
sandbox; every change is attributed to whoever made it and lands in an
append-only audit log, and every request and its database and driver work are traced into the server's
own database. People sign in by email and password; GitHub is an optional second door, configured from
the environment and absent unless it is.

The HTTP surface is spaces' own: `/api/v1`, bearer auth or the console's session cookie, one error
envelope, schemas defined once in `packages/shared`.

- **[API reference](docs/api.md)** — every endpoint, grouped, with examples
- **[Decisions](docs/decision/README.md)** — why the runtime, the surface and the console are shaped this way

## Deployment

One command, to any Linux host with KVM:

```bash
./scripts/deploy.sh your-host
```

It installs `bun` and `msb`, checks the host, builds the console, writes `/etc/spaces/spaces.env`,
installs a systemd unit and verifies `/health`. The API serves the console itself, listens on loopback,
and `tailscale serve` terminates HTTPS in front of it; restarting the service does not kill running
sandboxes. Targets, configuration and the full environment table:
[docs/configuration.md](docs/configuration.md).

That install is a cluster of one. To add a machine, register a runtime in the console and run the
command it prints on the machine that will hold sandboxes:

```bash
curl -fsSL https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh | bash -s -- \
  --runtime --url https://spaces.example.com --token spr_…
```

It installs Bun and `msb` if they are missing, writes `~/.spaces/runtime.env`, installs a user service
and waits for the agent to say it is connected. The agent dials out, so the machine needs no inbound
port and no SSH key. `spaces doctor` explains anything that went wrong, and `spaces update` is the same
command with no arguments. On the control plane, a runtime can be drained to stop taking new work
without disturbing what is on it.

## Development

Building, testing, the guest image and the schema: **[DEVELOPMENT.md](DEVELOPMENT.md)**.

## License

Licensed under the [Apache License 2.0](LICENSE); see [NOTICE](NOTICE) for attribution.

Built on [microsandbox](https://github.com/superradcompany/microsandbox) (Apache-2.0). See
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) for dependency licenses.

There is no hosted version yet and no commercial or enterprise offer — questions, or interest in one,
go to [hello@anvia.dev](mailto:hello@anvia.dev).

## Trademarks

"Spaces" and the Anvia name and logos are trademarks of Anvia. The Apache License does not grant
permission to use them: forks must use a different name and branding.
