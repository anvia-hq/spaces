# Internals

How the runtime actually does the things the API promises. Read this when you are changing the
driver, debugging a file operation, or wondering why a design choice is the way it is.

- [Files](#files)
- [Path safety](#path-safety)
- [Signed transfer URLs](#signed-transfer-urls)
- [Background commands](#background-commands)
- [Port publishing](#port-publishing)
- [SSH](#ssh)
- [The guest image](#the-guest-image)
- [The driver seam](#the-driver-seam)
- [Storage and validation](#storage-and-validation)
- [Measured performance](#measured-performance)
- [Host notes](#host-notes)

## Files

Every file operation rides on `msb exec` rather than `msb copy`, so there are no host temp files and
behaviour is identical whether `msb` runs locally or over SSH:

- **read** — `base64 < path` in the guest, decoded host-side. Binary-safe.
- **write** — base64 on stdin to `base64 -d > path`, so contents never touch an argv or a temp file.
- **list / info / search** — a POSIX shell snippet; listings are **NUL-framed**, so filenames
  containing tabs or newlines survive intact.

Fresh OCI images ship no `/home/user`; the driver creates it at sandbox creation because every
relative command path resolves against it.

Errors map onto the shared codes: `404 not_found` (ENOENT), `400 invalid_path` (EBADPATH / EISDIR /
ENOTDIR / protected root), `409 destination_exists`, `413 file_too_large`.

## Path safety

Two layers, because each catches what the other cannot:

1. **Host-side, lexical.** `resolveSandboxPath()` collapses `..` and requires the result to sit under
   `/home/user` or `/tmp`. Cheap, and rejects traversal before any round trip.
2. **Guest-side, canonical.** Every script canonicalises its path with `readlink -f` over the longest
   existing prefix, then re-checks the roots and answers `400 invalid_path` with `EBADPATH` on
   violation. This is what stops a symlink inside the sandbox from reaching outside.

The second layer only resolves what it should: for `info`, `delete` and `move` the **leaf is left
unresolved**, so a symlink is described, deleted or moved as a link rather than followed. A symlink is
deleted itself, never its target — which is also the safe behaviour: deleting a symlink that points at
`/etc` removes the link and leaves `/etc` untouched.

## Signed transfer URLs

`download-url` / `upload-url` could hand out a link the **sandbox** serves itself, but guests here have
no inbound address, so the API serves it and streams to and from the guest. The client shape stays
header-free: `GET` or `PUT` raw bytes with no `Authorization` header, bound to one path and method,
expiring after `ttlSeconds`.

The token is `base64url(claims) + "." + HMAC-SHA256`, keyed by `SPACES_SIGNING_KEY` (derived from the
API key when unset, so rotating the key invalidates outstanding links). Claims pin the method, sandbox
id, path and expiry — a download token cannot be replayed as an upload, and both are denied after
expiry. The transfer and preview routes are the only paths exempt from bearer auth, because the token
_is_ the credential.

Transfers bypass the 5 MiB inline cap and are bounded by `SPACES_TRANSFER_MAX` instead (default
100 MiB), because the body is buffered on both sides. A truly unlimited path would need real
streaming through the guest, which `msb exec` cannot express.

## Background commands

`detached` and `stream` are not just flags on `msb exec` — a plain `cmd &` inside the guest does
**not** detach. `msb exec` waits for its children, so a 5-second child holds the call for 5018 ms.
The runtime therefore launches through `setsid` with all three descriptors detached, which returns in
~50 ms and lets the child outlive the exec:

```sh
setsid "$dir/run.sh" </dev/null >/dev/null 2>&1 &
```

State lives in the guest under `/tmp/.spaces/proc/<commandId>/`: `out`, `err`, `exit`, `pid` (the
process _group_ id, so `DELETE` can signal everything the command started), and `cmd`.

Reading is offset-based — the guest serves `tail -c +<offset+1>` — so a polling client only transfers
what is new, and `GET /commands/{processId}` can answer with `stdoutNextOffset`. The public
`processId` is the guest pid, which is why the `commands` table carries a `pid` column: pid →
commandId must still resolve after the process has left the live table.

## Running as the sandbox user

`msb exec` has no uid flag and always starts as root, so the drop to the sandbox user happens
inside the guest. Every command is preceded by a small wrapper:

```sh
s=$1
if [ "$(id -u)" = 0 ] && id -u user >/dev/null 2>&1; then
  if command -v su >/dev/null 2>&1; then exec su user -s /bin/sh -c "$s"; fi
  if command -v setpriv >/dev/null 2>&1 && setpriv --reuid=0 true >/dev/null 2>&1; then
    exec setpriv --reuid=1000 --regid=1000 --clear-groups env HOME=/home/user sh -c "$s"
  fi
fi
exec sh -c "$s"
```

Three details are load-bearing:

- **`su` before `setpriv`.** Alpine's `/bin/setpriv` is the _busybox_ one, which only handles
  capabilities — it has no `--reuid` and fails with `unrecognized option`. Presence is not capability,
  so the util-linux one is probed by running it, not by `command -v`.
- **Positionals are folded into the script**, not passed as argv: the wrapper re-execs, and neither
  `su -c` nor `setpriv` carries extra arguments. `set -- 'a' 'b'` is prepended host-side with proper
  quoting, so `$1`, `$2` keep working for the scripts that expect them.
- **The account is created at every start**, not in the image: `create` and `resume` both run an
  idempotent init that creates `user` (1000), `chown`s `/home/user`, writes a passwordless sudoers
  entry where sudo exists, and makes `/tmp` sticky. Images differ (`adduser` on Alpine, `useradd` on
  Ubuntu), and a restored disk may predate the account.

Root is still used deliberately for: `SPACES_BOOTSTRAP` (it installs packages), sshd provisioning, and
the IP read-back. `setupScript` from a create request runs as `user`.

## Port publishing

A published port binds to loopback **on the host that runs `msb`**. Two consequences:

- When that host is not the host running the API, the preview proxy opens a local SSH forward
  (`ssh -N -L`) to it. The forward is cached per port and reused, so the remote port never leaves
  its loopback.
- Host-port availability is probed on the hypervisor (`ss -tln`), not on the API machine. Otherwise
  the allocator hands out a port another sandbox on that host already holds.

`msb` can only add a mapping to a **running** microVM by restarting it (484 ms, disk intact, guest
processes gone). Ports in `SPACES_PREPUBLISH_PORTS` are therefore reserved at create time, so
hosting them is instant; anything else takes the restart path and the response says
`restartRequired`. Rows carry an `explicit` flag so the ports reserved at create are not reported as
ones the user published.

## SSH

`POST /sshkey` installs openssh, creates `user`, authorizes the key, publishes port 22 and starts
sshd. Two details decide whether key auth works at all:

- `adduser` leaves the account **locked** (`!` in `/etc/shadow`) and OpenSSH refuses even pubkey
  logins for a locked account. The setup gives it an unusable random hash, with
  `PasswordAuthentication` off so it only unlocks it.
- The port is published **before** sshd starts, because publishing restarts the microVM and would
  otherwise kill the daemon it just launched.

The key travels as an argv (`ExecRequest.args`), never interpolated into a shell script.

## The guest image

`SPACES_MSB_IMAGE` names the OCI image new sandboxes boot from; the default is `alpine`. Two images in
`deploy/guest/` are built around that:

- `Dockerfile` — the ready base: Ubuntu 24.04, `curl git tar procps sudo jq unzip`, the uid-1000 `user`
  with `HOME=/home/user` and passwordless sudo, and **root as the image's default user** so `msb exec`
  can still provision sshd and packages.
- `Dockerfile.starter` — `FROM spaces/guest:ubuntu`, adding Node 26 via nvm, bun, uv/uvx, the GitHub CLI
  and Playwright with Chromium, plus `build-essential` and `python3`.

A deployment gets one by building it on the machine that runs `msb`, then loading it — there is no
registry. `scripts/deploy.sh` does exactly this with whatever image `SPACES_MSB_IMAGE` names:

```sh
docker build -t spaces/guest:starter -f deploy/guest/Dockerfile.starter .
docker save spaces/guest:starter | msb load -t spaces/guest:starter
SPACES_MSB_IMAGE=spaces/guest:starter ./scripts/deploy.sh <host>
```

The part that decides whether the image is _usable_ is PATH, and none of the obvious mechanisms
survive the trip:

- **The image's `ENV` is not forwarded to `msb exec`.** microsandbox runs the command from a guest agent
  with no PATH of its own, so `ENV PATH=...` does nothing for a session.
- **The privilege wrapper is a login shell.** `su user -s /bin/sh -c "$s"` — `su` without `-` and with a
  default login shell counts as a login shell — rebuilds PATH from `/etc/environment` and sources
  `/etc/profile.d/*.sh`. It never reads `~/.profile`: the shell is dash.

So the starter image puts the toolchain directories in three places (image `ENV`, `/etc/environment`,
`/etc/profile.d/nvm.sh`) and asserts them at build time, including `dash -lc 'command -v node'`, which is
the mechanism `su -c` uses. `~/.nvm/current/bin` is on PATH rather than the versioned directory, so
`nvm use 22` moves the whole entry. `deploy/guest/guest-toolchain-probe.sh` runs the driver's
`GUEST_INIT` and its wrapper verbatim against a built image; the reasoning is
[decision 0035](decision/0035-starter-guest-image.md).

## The driver seam

`SandboxDriver` (`apps/api/src/modules/driver/types.ts`) is the only seam between HTTP and infrastructure.

- **`microsandbox`** (default) — shells out to `msb` either locally or over SSH. Refs are
  `msb:<name>` for machines and `snap:<group>:<name>` for snapshots.
- **`mock`** — in-process fixture, no hypervisor. `SPACES_DRIVER=mock` for tests or CI.

`runRemote()` (`apps/api/src/modules/driver/ssh.ts`) picks the transport: `SPACES_MSB_HOST=local` spawns
directly, anything else goes over a multiplexed SSH connection. Arguments are quoted per-argument
with only the tilde left for the remote shell, so `~/.local/bin/msb` expands and nothing else can be
interpreted.

**Stop is a disk operation, deliberately:** snapshots capture the _disk_. `stop` frees the machine and
keeps the disk; `resume` starts it again. Memory state and running programs do not survive. `msb`
can also take full memory snapshots (restore measured at 222 ms) — that capability is available but
not wired into the API: stop and resume promise a disk, not a paused process. Changing that needs a
new route of its own (decision 0011).

Creating from a saved snapshot is a restore, not a fork: the driver boots `msb restore` into the new
sandbox with the requested size and ports, on the snapshot's disk (decision 0038). `restoreTemporary`
stays separate and throwaway, for browsing snapshot files (0018).

## Storage and validation

Drizzle ORM over Postgres, through Bun's built-in `SQL` client (`drizzle-orm/bun-sql`). Migrations
are generated from `packages/db/src/schema.ts` into `packages/db/drizzle/` and applied automatically
at boot. The connection is `SPACES_DATABASE_URL`; there is no file fallback (decision 0030).

```bash
SPACES_DATABASE_URL=... bun run --cwd packages/db generate   # after editing schema.ts
psql -c 'drop database spaces' -c 'create database spaces'   # start over
```

Timestamps are `timestamptz` in `mode: "string"`, so SQL compares them as time and the API still hands
out ISO-8601 strings. JSON columns (`labels`, `env`, `payload`, `manifest`) are `jsonb`, parsed once in
the store. Byte counts (`snapshots.size_bytes`, `saved_snapshots.size_bytes`) are `bigint`: a 4 GiB
disk is 4,294,967,296, which does not fit an `integer`.

Moving an existing SQLite deployment over: `scripts/migrate-sqlite-to-postgres.ts` (the deploy script
runs it when it finds a legacy `data/spaces.db` and an empty target).

Every route validates through `@hono/zod-validator` with schemas from `@spaces/shared`:

- `strict()` bodies reject unknown fields → `400 invalid_body`
- `strict()` queries reject unknown fields → `400 invalid_query`, naming the offending parameter
- Failures return the shared `ErrorEnvelope` (`ok/type/status/code/message/requestId/error`)

## Measured performance

2 vCPU / 4 GiB, warm image, on the two hosts used during development:

|                           | Apple M4 (local) | Ryzen 7 5700X (remote) |
| ------------------------- | ---------------- | ---------------------- |
| Boot to usable            | 228–246 ms       | 259–271 ms             |
| Idle RSS                  | —                | 224 MiB                |
| Exec, `msb` direct        | 13 ms            | 10 ms                  |
| Exec through the full API | **20–24 ms**     | 41–45 ms               |
| Disk snapshot             | —                | 26 ms                  |
| Full (memory) snapshot    | —                | 1.2 s                  |
| Restore from memory       | —                | 222 ms                 |
| Fork                      | —                | 1.27 s                 |

Measured on the 16-core AMD host used for deployment (`spaces/guest:ubuntu`, the ready image):

|                                                 |                         |
| ----------------------------------------------- | ----------------------- |
| Boot to usable, ready image                     | **0.6 s**               |
| Boot to usable, stock `alpine`                  | 250 ms                  |
| Privilege drop (`su` + folded script)           | 0–10 ms                 |
| Detached command survives its `timeoutSeconds`? | No, unless it `setsid`s |

Running locally removes the SSH hop and roughly halves exec latency. Guest RAM dominates resident
memory (~2.5% of configured size) far more than the VMM does.

## Host notes

`msb doctor` reports what the host can do. Two warnings are common and harmless on `ext4`:

- **No reflink** — clones fall back to sparse copies, so forks are slower and private roots allocate
  more storage. A reflink-capable filesystem enables copy-on-write clones.
- **APICv disabled by KVM policy** — optional; correctness and isolation are unaffected.

Docker inside a guest needs `--storage-driver=vfs` (overlay-on-ext4 inside the guest fails with
`invalid argument`) and `sysctl -w net.ipv4.ip_forward=1` for container egress.

Linux hosts need VT-x/AMD-V exposed by firmware. `VMX (outside TXT) disabled by BIOS` in `dmesg`
means the setting is off in BIOS, which cannot be changed remotely.

## Accounts and ownership

`modules/auth/service.ts` builds the Better Auth instance (Drizzle adapter on the same SQLite handle,
email + password, the API-key plugin). Its route is mounted at `/api/auth/*` and its tables live in
`packages/db/src/auth-schema.ts`, generated by the Better Auth CLI (`bun run --cwd apps/api auth:schema`).

`src/auth.ts` resolves the caller — session cookie, then the operator key, then a user API key — and
puts the result in an `AsyncLocalStorage` scope (`src/scope.ts`) for the rest of the request. `db.ts`
filters every owned read against that scope, so a handler that forgets to check a sandbox's owner
cannot leak it: another account's row reads as missing. System work (the reaper, provisioning) runs
with no scope and sees everything. The full reasoning is [decision 0028](decision/0028-accounts-and-api-keys.md).
