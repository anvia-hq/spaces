# 0043 — A runtime is installed by one command, run on the machine

- **Status:** accepted
- **Date:** 2026-11-18
- **Builds on:** 0042. Copies the shape of a decision in a product that has already been through it.

## Context

Registering a runtime (0042) was a token and a list of manual steps: install Bun, install `msb`, put the code somewhere, write an env file, write a unit file, start it. A first version of this decision was a script run from the operator's machine that did all of that over SSH. It needs the operator to have SSH to every runtime, which is the credential the agent design exists to avoid, and it is the opposite of the shape that works: the person who owns the machine runs one command on it.

## Decision

- **The console shows the command.** Registering a runtime (Runtimes, Register) shows the token once, with the command to run **on that machine**:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh | bash -s -- \
    --runtime --url https://spaces.example.com --token spr_...
  ```

  The token is in the command because it is shown once anyway; a person who would rather not paste it can set `SPACES_RUNTIME_TOKEN` instead.

- **Two layers, as in the installer this follows.** `install.sh` (repository root) is bash and does only what must happen before there is a program: check `curl` and `tar`, install Bun and `msb` when they are missing (asking first; `SPACES_YES=1` answers yes), fetch the source into `~/.spaces/src`, `bun install`, put a `spaces` launcher on the PATH, and hand the rest to `spaces install`. Everything after `bash -s --` is passed on. The program is `apps/cli`, TypeScript, tested, with no dependencies.
- **What `spaces install --runtime` does.** Check `msb doctor` (KVM, firmware, permissions) and refuse to go on with its output when the host is not ready. Reach the control plane from this machine (`/health`) and ask it whether the token is known (`/runtime/connect` answers `401` to one that is not) before anything is written, so a wrong token fails at the terminal, not as a service that never connects. Write `~/.spaces/runtime.env` (0600), install a **user service** (systemd `--user` with lingering on Linux, a launchd agent on macOS), start it and wait for the agent's own "connected" line in its log.
- **Run again to update.** `install.sh` with no arguments, or `spaces update`, fetches the source again and reinstalls; the settings are read back from `runtime.env`, so no token is needed. Restarting the service does not kill running sandboxes (`KillMode=process` on Linux, `AbandonProcessGroup` on macOS).
- **A user service, not a system unit.** It needs no root after the dependencies, runs as the person who owns the machine and their KVM access, and `~/.spaces` is the one place to look (`SPACES_HOME` moves it). It is `spaces runtime run`, which loads `runtime.env` and then runs the agent in its own process, so a launchd agent, which has no env file of its own, behaves like the systemd one.
- **The rest of the CLI:** `spaces runtime status|logs|restart|stop|start|run`, `spaces doctor` (every check with its answer: Bun, `msb`, KVM, settings, control plane, token, service), `spaces update`, `spaces uninstall` (the service goes, `~/.spaces` stays unless `--purge --yes`).
- **Rename a runtime.** `PATCH /runtimes/{runtime}` accepts `name`. The name is only a label; sandboxes point at the id.
- **The server is not part of this.** `scripts/deploy.sh` still installs a control plane. A server install in the same command is a separate decision.

## Consequences

- There are no releases yet, so the source is a GitHub archive of a ref (`SPACES_INSTALL_REF`, default `main`; a tag works the same) and `SPACES_SOURCE_URL` overrides where it comes from, which is how the installer is tested without the network. A published release with checksums is the next step; the archive is not verified against anything, so the install trusts GitHub and TLS.
- A runtime installed from `main` and a control plane at another commit may disagree about the protocol. The handshake refuses a mismatch with the reason (0042), and `spaces update` is the fix; telling an operator in the console that a runtime is behind, and updating it from there, needs a version to compare and is not built.
- `bun install` fetches the whole workspace, console included, because the lockfile covers it. It is a few seconds and some disk, and is the price of not publishing a second artifact.
- Windows is not supported (WSL2 with Ubuntu is the workaround, untested here).
- The hand-written `deploy/spaces-agent.service` and its env example are gone: the CLI writes the same unit from one place, and a second copy would drift.

## Alternatives considered

- **A script that pushes over SSH** (the first version). Rejected for the credential it needs and because it is not how the person who owns a machine expects to install something on it.
- **A compiled binary** (`bun build --compile`). Better start-up and no Bun on the machine, but it needs a release pipeline and a build per OS and architecture before the first runtime can be installed. The CLI is written so the entry point can become one.
- **A system unit written by the installer with `sudo`.** Needs root, and runs as whoever the unit says; a user service is simpler and matches how the machine's owner already thinks about it.
