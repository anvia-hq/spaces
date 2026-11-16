# 0015 — SSH by provisioning sshd inside the guest

- **Status:** accepted
- **Date:** 2026-11-15

## Context

`POST /sshkey` has to take a caller from "here is my public key" to a working `ssh` command. Guests
here are stock Alpine: no sshd, no user, and no public address, so there is no `machineIp` to return.
The response carries `sshEndpoint` (`host:port`) instead, because a machine here has no public IPv4 of
its own.

## Decision

`POST /sshkey` does the whole job: installs `openssh` via `apk`, creates `user`, writes
`authorized_keys`, generates host keys, publishes port 22, then starts sshd detached. It answers with
`sshEndpoint` (`host:port`), `sshUser` and the server's `hostKey`.

Two details turned out to be load-bearing:

- `adduser` leaves the account **locked** (`!` in `/etc/shadow`), and OpenSSH refuses **even pubkey
  logins** for a locked account. The setup assigns an unusable random hash, with
  `PasswordAuthentication=no` so it only unlocks the account.
- The port is published **before** sshd starts, because publishing restarts the microVM (0014) and
  would otherwise kill the daemon just launched.

The public key travels as an argv (`ExecRequest.args`), never interpolated into a script.

## Consequences

- Works on a stock image with no custom build, in ~3.5 s cold (the `apk` install) and ~2.2 s warm.
- `PasswordAuthentication` is off and `PermitRootLogin` is off; key auth is the only path, and the
  random hash is not a usable credential.
- The guest now has a listening sshd for the rest of its life. Acceptable: the port is loopback-bound
  on the host and only reachable through a published forward.
- When the API and `msb` are on different machines, a loopback-bound port is not reachable from the
  client. The response says so and prints the exact `ssh -L` line, rather than claiming success.

## Alternatives considered

- **Ship a custom image with sshd preinstalled.** Rejected: see 0016 — images stay stock.
- **`msb ssh` (agent transport).** Kept as a debugging tool, but it requires the msb CLI on the
  client; a plain `ssh` command is what users expect.
