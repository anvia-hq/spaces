# 0017 — Driving `msb` on another machine over SSH

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`SPACES_MSB_HOST=<ssh-host>` lets the API use a KVM box on the network instead of the local machine.
The feature existed from the start and was assumed to work. Deploying against a second host
(`devscalelabs-1`, Ubuntu 24.04, i5-6400T) proved it had never actually worked with the default
configuration, and exposed two more assumptions that only hold when `msb` is local.

## Decision

Keep the SSH transport, and fix the three defects it revealed:

1. **Argument quoting.** The default `SPACES_MSB=~/.local/bin/msb` was shell-quoted into a _literal_
   path, so bash answered `No such file or directory`. `remoteQuote()` leaves only the tilde for the
   remote shell and quotes the remainder, so the path expands and nothing else is interpreted.
2. **Port availability must be probed where the port binds.** The allocator bind-tested the _API_
   machine, so it re-issued `22000–22007` while another sandbox on the hypervisor still held them —
   surfacing as an opaque `msb create failed`. A remote host is now asked once per reservation
   (`ss -tln`), checked in memory.
3. **Preview traffic must reach the hypervisor.** The proxy dialled `127.0.0.1` locally, so every
   hosted port on a remote host returned `502` while listening perfectly over there. The proxy now
   opens a cached `ssh -N -L` forward, so the remote port never leaves its loopback.

`/sshkey` reports the host that actually holds the port, and when that port is loopback-only it says so
and prints the `ssh -L` line to use.

## Consequences

- Remote deployment works with the default configuration, verified 20/20 including remote snapshot
  restore, proxying and SSH: create 1.1–1.5 s, exec 81 ms over SSH.
- Security posture is preserved: published ports stay on the hypervisor's loopback and are reached
  through the existing SSH trust, not exposed on an interface.
- The remote path costs a round trip per `msb` call (81 ms vs 20–24 ms local), so the local driver
  remains the fast path and is the documented default.
- One forward per published port is cached for the process lifetime; a dead `ssh` evicts itself.
- Lesson recorded: the local driver must not be the only one exercised. The defaults were broken for
  an entire development cycle because only the local path was tested.

## Alternatives considered

- **Bind published ports on `0.0.0.0` and dial the host directly.** Rejected as the default: exposes
  every published port to the network. Available via `SPACES_PORT_BIND` for operators who want it.
- **Require `SPACES_MSB` to be an absolute path when remote.** Rejected: pushes a setup gotcha onto
  the user to avoid fixing quoting.
