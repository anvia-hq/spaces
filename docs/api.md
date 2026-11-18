# API reference

This file is the contract. Every route below is what the server implements, validated against the
same zod schemas in `packages/shared`; a change to it lands with a decision record.

- Base path: `/api/v1`
- Auth: `Authorization: Bearer <key>` (the operator key, or a key from `/api-keys`), or the Better Auth
  session cookie the console uses after signing in
- Errors: `{ ok: false, type, status, code, message, requestId, error: { code, message, status } }`
- Schemas: [`packages/shared`](../packages/shared) — one file per domain

`GET /health` sits at the root, outside `/api/v1`, and needs no auth. It reports the built-in
runtime's driver and `runtimes: { online, total }`. `GET /runtime/connect` also sits at the root: it
is the WebSocket a [runtime agent](#runtimes) dials, and it takes a runtime token, not an API key.

The surface covers sandboxes, files, commands, snapshots, ports, SSH, usage and the machine sizes a
sandbox can be created at. Routes for a capability this deployment does not run are absent or answer
`501` — see [scope](#scope).

## Request conventions

- **An empty body means `{}`.** `Content-Type: application/json` with no body is accepted on every
  route whose body is optional (`POST /sandboxes`, `/stop`, `/resume`, …).
- **Unknown fields are rejected** — `400 invalid_body` on a body, `400 invalid_query` on a query,
  naming the field. Fields that are accepted but not acted on are listed in
  [create fields](#create-fields).
- **Commands run as `user`** — uid/gid 1000, `HOME=/home/user`, passwordless `sudo`. Files written
  through the API are owned by that user, not by root.
- **`202` means started, not finished.** Create, resume and fork answer `202` with a sandbox in a
  transitional state; poll `GET /sandboxes/{id}` until `ready`.

## Sandboxes

| Method                 | Path                             | Notes                                                                   |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| `GET`                  | `/limits`                        | Local capacity, not billing                                             |
| `GET`/`POST`           | `/sandboxes`                     | `Idempotency-Key` honoured; `state`/`name`/`namePrefix`/`label` filters |
| `GET`/`PATCH`/`DELETE` | `/sandboxes/{id}`                |                                                                         |
| `POST`                 | `/sandboxes/{id}/stop`           | Frees the machine, keeps the disk; returns a stop operation             |
| `GET`                  | `/sandboxes/{id}/stops/{stopId}` | Pollable after a resume                                                 |
| `POST`                 | `/sandboxes/{id}/resume`         | Boots the disk again                                                    |
| `POST`                 | `/sandboxes/{id}/fork`           | Copy-on-write child of the disk                                         |
| `POST`                 | `/sandboxes/{id}/recover`        | Power-cycles the machine, disk untouched                                |
| `GET`                  | `/sandboxes/{id}/events`         | Lifecycle timeline                                                      |
| `GET`                  | `/sandboxes/{id}/usage`          | Billable machine-seconds inside a window                                |

### Create fields

`POST /sandboxes` accepts a wider shape than it acts on: fields kept for clients written against an
earlier version are accepted rather than rejected, and recorded in
[decision 0021](./decision/0021-extensions-and-honest-refusals.md):

| Field                                                                                                                         | Status                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `type`, `ttlSeconds`, `labels`, `env`, `name`                                                                                 | **Honoured.** `ttlSeconds: null` (or the legacy `"infinite"`) disables auto-stop; `env` is injected into the guest                        |
| `from`                                                                                                                        | **Honoured** for a sandbox id (fork its disk) or a saved snapshot name visible to the caller (restore its disk). Never a silent cold boot |
| `runtime`                                                                                                                     | **Honoured.** A runtime id or name to create on. Omitted, the control plane picks one; see [runtimes](#runtimes)                          |
| `setupScript`                                                                                                                 | **Honoured**: runs once after `ready` as `user`; the outcome is recorded as a `sandbox.setup_script` event                                |
| `environment`, `noEnv`, `visibility`, `snapshots`, `monitoring`, `failFast`, `count`, `hostedPorts`, `files`, `org`, `teamId` | **Accepted and ignored.** Write `files` with `PUT /sandboxes/{id}/files`; publish `hostedPorts` with `POST /sandboxes/{id}/host`          |

`POST /sandboxes/{id}/resume` takes `ttlSeconds` (resets the auto-stop timer from the resume, not from
the original create), `type` (moves the sandbox to another size) and `name`, and accepts the other
tolerated fields unchanged.

**Creating from a saved snapshot.** `from` may name a saved snapshot the caller can see. The new
sandbox gets its own `type`, `env`, `labels`, `ttlSeconds` and `setupScript`, and boots from a copy of
the saved disk; the saved snapshot and its artifact are not consumed. An unknown or inaccessible name,
a `bsh_` code, or a missing artifact answers `404 snapshot_not_found`; a saved snapshot still `saving`
or `failed`, or one whose artifact is not ready, answers `409 snapshot_not_ready`. Spaces imposes no
lifetime of its own on a saved snapshot — deleting it is the caller's job (decision
[0038](./decision/0038-create-from-a-saved-snapshot.md)).

### `type` is a machine size name

`type` names a preset from `GET /machine-sizes` (decision
[0034](./decision/0034-operator-defined-machine-sizes.md)). It is a lower-case name of up to 32
characters (`^[a-z][a-z0-9-]{0,31}$`), not a closed list: the four presets a fresh deployment starts
with are `small`, `default`, `large` and `xlarge`.

- A create without `type` uses `default`. `default` cannot be retired.
- A name that does not exist, or one that was retired, answers `404 not_found` with
  `retired_machine_size:` at the start of the message. It never falls back to a default size.
- `GET /limits` `allowedTypes` lists the active presets; `GET /machine-sizes` carries their vCPU,
  RAM and disk.
- Resuming or forking into a different `type` applies that preset's current numbers to a new boot.
  Editing a preset does not resize sandboxes already running at it.

## Runtimes

A runtime is a machine that runs sandboxes. The control plane (this API) keeps the accounts, the
store and the console and schedules onto runtimes; the built-in `local` runtime is the driver
embedded in the API process, and any number of agent runtimes can be registered beside it (decision
[0042](./decision/0042-control-plane-and-runtimes.md)).

| Method   | Path                        | Notes                                                                           |
| -------- | --------------------------- | ------------------------------------------------------------------------------- |
| `GET`    | `/runtimes`                 | Every runtime with its load; any authenticated caller                           |
| `GET`    | `/runtimes/{runtime}`       | By id (`rt_…`, or `local`) or by name                                           |
| `GET`    | `/runtimes/samples`         | Capacity history; `?minutes=` (5–10080, default 360), `?runtime=` to narrow     |
| `POST`   | `/runtimes`                 | Admin only; `{ name, labels?, maxSandboxes? }`; answers `201` with `token` once |
| `PATCH`  | `/runtimes/{runtime}`       | Admin only; any of `name`, `labels`, `maxSandboxes` (`null` clears), `draining` |
| `POST`   | `/runtimes/{runtime}/token` | Admin only; new token, and the connected agent is cut off at once               |
| `DELETE` | `/runtimes/{runtime}`       | Admin only; `409` while it holds sandboxes or snapshots, `403` for `local`      |

Changes need the operator key or an account with the `admin` role, exactly like
[machine sizes](#machine-sizes), and are in the [audit log](#audit-log) as `runtime.create`,
`runtime.update`, `runtime.token_rotate` and `runtime.delete`. The token is never in the log.

```json
{
  "id": "rt_3f9a1c07b2d4",
  "name": "edge-1",
  "kind": "agent",
  "state": "online",
  "draining": false,
  "labels": { "zone": "eu" },
  "maxSandboxes": 8,
  "activeSandboxes": 3,
  "totalSandboxes": 5,
  "snapshots": 2,
  "resources": { "vcpu": 16, "memMib": 31744 },
  "committed": { "vcpu": 6, "memMib": 12288 },
  "driver": "microsandbox",
  "capabilities": { "exec": true, "files": true, "persistence": true },
  "publicHost": "edge-1.example.com",
  "agentVersion": "0.1.0",
  "tokenPrefix": "spr_d2f1096d",
  "connectedAt": "2026-11-18T03:54:51.860Z",
  "lastSeenAt": "2026-11-18T03:56:11.002Z",
  "createdAt": "2026-11-18T03:50:00.000Z"
}
```

`resources` is what the runtime reported (`null` if nothing); `committed` is the sum of the sizes of
its active sandboxes. Capacity is reserved, not measured: an idle sandbox still holds its size.

**Registering a runtime** is two steps: `POST /runtimes` (the console's Register button), then run the
installer **on that machine** with the token. The runtime dials out, so the machine needs no inbound
port:

```bash
curl -fsSL https://raw.githubusercontent.com/anvia-hq/spaces/main/install.sh | bash -s -- \
  --runtime --url https://spaces.example.com --token spr_… --public-host edge-1.example.com
```

The console shows this command with the token filled in. The installer checks the host, reaches the
control plane and asks it whether the token is known before it writes anything, then installs a user
service and waits for the connection; running it again updates
([decision 0043](./decision/0043-install-a-runtime-with-one-command.md)). `PATCH /runtimes/{runtime}`
with `name` renames a runtime; its id and sandboxes do not change.

**Where a sandbox goes.** Every sandbox, and every snapshot made from it, records the `runtimeId` it
lives on, because its disk is on that machine. Resume, fork, stop, snapshot, files, commands and
previews all go there; nothing moves a disk. Only a create with no source chooses:

- `runtime` on the create request pins it to that runtime. An unknown one is `404`.
- Otherwise the control plane picks among the runtimes that are `online`, not `draining`, under
  `maxSandboxes` and with room for the size. Each runtime reports its vCPU and memory, and what its
  active sandboxes hold is the sum of their machine sizes. Of those that fit, the one that would be
  least full afterwards wins, judged on the fuller of vCPU and memory. Ties go to fewer active
  sandboxes, then the lower name. A runtime that reported no capacity is never refused for room and
  is used only when no measured runtime fits.
- `from` pins to the runtime that holds the source disk. Naming a different `runtime` answers
  `400`.
- A `draining` runtime keeps what it has and takes nothing new, including forks and restores whose
  source is on it (`403`). A runtime at its cap, or without room for the size, answers `403` when
  pinned to, with what was asked and what is free.
- **Resume is checked too.** A stopped sandbox holds no capacity, so `POST /sandboxes/{id}/resume`
  (and a resume into a bigger `type`) answers `403` if its runtime has no room, and the sandbox
  stays `archived`.

**When a runtime is away.** An agent that disconnects, or goes three heartbeats (15 s) without a
word, is `offline`. Reads of its sandboxes still answer from the store. Anything that has to reach
the machine answers `503 runtime_unavailable` (retryable) and changes nothing: a stop does not mark
the sandbox `error`, and a delete is refused rather than orphaning the machine. The auto-stop sweep
skips an offline runtime's sandboxes and tries again when it returns. With nothing able to take a
new sandbox, a create answers `503` and lists each runtime's reason.

**Ports and previews.** Each runtime allocates host ports from the range it advertised
(`SPACES_PORT_RANGE_START`/`_END` on the agent) and binds them to its own loopback. Preview URLs are
served by the control plane, which streams the request to the runtime and the answer back, so a
runtime is never reached directly. A file larger than about 90 MiB cannot be written to an agent
runtime (`413 file_too_large`); the built-in runtime has no such ceiling beyond `SPACES_TRANSFER_MAX`. `sshEndpoint` from `POST /sandboxes/{id}/sshkey` names the
runtime's `publicHost`; SSH itself is not relayed (decision 0042).

## Machine sizes

| Method   | Path                    | Notes                                                              |
| -------- | ----------------------- | ------------------------------------------------------------------ |
| `GET`    | `/machine-sizes`        | Active presets, smallest first; `includeRetired=true` adds retired |
| `POST`   | `/machine-sizes`        | Operator only; `{ name, vcpu, memMib, diskGb, description? }`      |
| `PATCH`  | `/machine-sizes/{name}` | Operator only; any of `vcpu`, `memMib`, `diskGb`, `description`    |
| `DELETE` | `/machine-sizes/{name}` | Operator only; retires, does not delete (see below)                |

`default` can be edited like any other preset — it is what a create falls back to, not a fixed
shape — but it cannot be retired, because every deployment needs a size to fall back to. An edit takes
effect on the next create, and on the next resume of a sandbox carrying that preset's name; a disk keeps
the size it was created with, so a larger `diskGb` only reaches new sandboxes.

Any authenticated caller may read the list — the console needs it to render the create dialog.
Changing it takes the operator key (`SPACES_API_KEY`) **or a signed-in account with the `admin` role**,
sent as its session cookie or as one of its own API keys; anything else answers `403 forbidden` with
the reason. See [admin role](#admin-role). Every change is in the
[audit log](#audit-log) as `machine_size.create`, `machine_size.update` or `machine_size.retire`,
with the preset name as the target.

```json
{
  "name": "large",
  "vcpu": 8,
  "memMib": 16384,
  "diskGb": 111,
  "description": "Eight cores, 16 GiB",
  "retiredAt": null,
  "createdAt": "2026-11-16T00:00:00.000Z",
  "updatedAt": "2026-11-16T00:00:00.000Z"
}
```

| Field         | Range                                                  |
| ------------- | ------------------------------------------------------ |
| `name`        | `^[a-z][a-z0-9-]{0,31}$`, unique; a duplicate is `409` |
| `vcpu`        | 1–64                                                   |
| `memMib`      | 512–262144                                             |
| `diskGb`      | 5–2048                                                 |
| `description` | up to 200 characters; `null` clears it                 |

**`DELETE` retires; it does not delete.** The row keeps its name, so sandboxes already created at
that size stay readable (and keep reporting it on their own resource). A retired preset is not in
`GET /machine-sizes`, not in `allowedTypes`, and cannot be created, resumed or forked into; it does
not appear in the console's size list. The response is
`{ name, retiredAt, inUse }`, where `inUse` counts the sandboxes ever created at that size.
`default` answers `403` (it is the fallback every create without a type relies on), retiring a name
that is already retired is idempotent, and a retired preset cannot be edited. Create it again to
reuse the name.

## Commands

| Method   | Path                                               | Notes                                                                        |
| -------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `POST`   | `/sandboxes/{id}/commands`                         | Synchronous, `detached`, or `stream`                                         |
| `GET`    | `/sandboxes/{id}/commands/{processId}`             | Status and log tails; `stdoutOffset`/`stderrOffset`/`tailBytes`              |
| `GET`    | `/sandboxes/{id}/commands/{processId}/stream`      | `application/x-ndjson`: `attached`, chunks, `heartbeat`, `exit`, `reconnect` |
| `DELETE` | `/sandboxes/{id}/commands/{processId}`             | SIGTERM the process group, SIGKILL after 5 s                                 |
| `GET`    | `/sandboxes/{id}/processes`                        | Live `ps`, joined to tracked commands                                        |
| `GET`    | `/sandboxes/{id}/command-history`                  | Every command and its outcome                                                |
| `GET`    | `/sandboxes/{id}/command-history/{commandId}`      | One record                                                                   |
| `GET`    | `/sandboxes/{id}/command-history/{commandId}/logs` | Paged byte reads; `utf8` or `base64`                                         |
| `GET`    | `/sandboxes/{id}/artifacts`                        | Raw bytes for one path                                                       |

**`detached` is still bounded by `timeoutSeconds`** (default 30, max 600): when it elapses the
process group is killed. A process meant to outlive that has to leave the group:

```bash
curl -s -H "$K" -H "$J" -X POST $B/sandboxes/bx_xxx/commands -d '{
  "command": "nohup setsid ./server >/tmp/server.log 2>&1 &",
  "detached": true
}'
```

`setsid` puts it in a new session so group signals miss it; `nohup` survives the hangup. Anything the
command starts _without_ `setsid` dies with it.

**`GET /processes` needs `procps`** in the guest (`ps -o`). Stock `alpine` has only busybox `ps`; use
the ready guest image — see [Guest image](../DEVELOPMENT.md#guest-image).

## Files

| Method               | Path                                 | Notes                                                     |
| -------------------- | ------------------------------------ | --------------------------------------------------------- |
| `GET`/`PUT`/`DELETE` | `/sandboxes/{id}/files`              | Inline read/write/delete, 5 MiB limit, `utf8` or `base64` |
| `GET`                | `/sandboxes/{id}/files/list`         | One level, sorted, 10,000 cap                             |
| `GET`                | `/sandboxes/{id}/files/info`         | Size, mode, type, mtime                                   |
| `POST`               | `/sandboxes/{id}/files/folder`       | `mkdir -p` semantics, optional mode                       |
| `POST`               | `/sandboxes/{id}/files/move`         | With `overwrite`                                          |
| `GET`                | `/sandboxes/{id}/files/search`       | Glob on names                                             |
| `GET`                | `/sandboxes/{id}/files/find`         | Content search: `file`/`line`/`content`                   |
| `POST`               | `/sandboxes/{id}/files/permissions`  | `chmod`; ownership untouched                              |
| `POST`               | `/sandboxes/{id}/files/replace`      | Literal replace across ≤100 files, per-file results       |
| `POST`               | `/sandboxes/{id}/files/download-url` | Signed GET, no auth header, up to 100 MiB                 |
| `POST`               | `/sandboxes/{id}/files/upload-url`   | Signed PUT, creates parent dirs                           |

## Networking and access

| Method   | Path                          | Notes                                                      |
| -------- | ----------------------------- | ---------------------------------------------------------- |
| `POST`   | `/sandboxes/{id}/host`        | Publish a guest port, get a proxied URL                    |
| `DELETE` | `/sandboxes/{id}/host/{port}` | Unpublish                                                  |
| `GET`    | `/sandboxes/{id}/ports`       | Published ports — **extension**: no other route lists them |
| `POST`   | `/sandboxes/{id}/sshkey`      | Authorize a key, start sshd, publish port 22               |

Guest egress follows `SPACES_NET` (default `public`: public addresses reachable, private ones denied).
To reach a LAN or tailnet service either lift filtering with `SPACES_NET=all`, or allow one target:

```bash
SPACES_NET_RULES='allow@192.168.1.50,allow@100.101.102.103:tcp:5432'
```

Rules use msb's grammar `<action>[:<direction>]@<target>[:<proto>[:<ports>]]` and win over the
profile. See [Networking](./configuration.md#networking).

## Snapshots

| Method                | Path                                       | Notes                                                    |
| --------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `GET`/`POST`          | `/saved-snapshots`                         | Save under a name; list with `name`/`namePrefix` filters |
| `GET`/`DELETE`        | `/saved-snapshots/{name}`                  | Re-saving a name replaces its artifact                   |
| `GET`/`POST`          | `/saved-snapshots/{name}/shares`           | Codes hashed, shown once                                 |
| `DELETE`              | `/saved-snapshots/{name}/shares/{shareId}` | Revoke                                                   |
| `GET`/`POST`/`DELETE` | `/named-snapshots[/{name}]`                | Deprecated aliases of the saved-snapshot routes          |
| `GET`                 | `/snapshots`                               | Every snapshot artifact                                  |
| `GET`/`DELETE`        | `/snapshots/{id}`                          |                                                          |
| `GET`/`DELETE`        | `/sandboxes/{id}/snapshots[/latest]`       |                                                          |
| `GET`                 | `/snapshots/{id}/tree`                     | Flat listing, cached per snapshot                        |
| `GET`                 | `/snapshots/{id}/files`                    | File bytes or a subtree tar; `Range` → 206               |
| `GET`                 | `/snapshots/{id}/download`                 | Signed chunk URL for the workdir tar                     |

## Scope

The tenancy and SaaS surface has no meaning for a self-hosted runtime and is absent (404), not
stubbed: `/orgs`, `/account/*`, `/webhooks`, `/billing`, `/credential-profiles`, `/ai-proxy`,
`/telemetry`, `/ci`, `/repos`, `/environments`, `/secrets`.

`/api-keys` and `/me` do exist, but as this server's own shapes for its own accounts (below).
`/ai-usage` keeps answering an empty meter rather than 404, so a polling client does not break.

Routes that older clients still call but that nothing here can back answer
`501 provider_not_configured` with the actual reason, rather than a fake success or a misleading 404:

| Path                                                                                | Why                                                   |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `/sandboxes/{id}/desktop`                                                           | No display server, and noVNC needs WebSocket proxying |
| `/sandboxes/{id}/prompt`, `/steer`, `/interrupt`, `/conversations`, `/prompts/{id}` | No integrated AI agent                                |
| `/sandboxes/{id}/ai-access`                                                         | No AI proxy                                           |
| `/sandboxes/{id}/share`, `/unshare`                                                 | No accounts or organizations                          |

## Accounts and keys

People sign in with an email and password, or with GitHub where the deployment configured an OAuth app
(`SPACES_GITHUB_CLIENT_ID` + `SPACES_GITHUB_CLIENT_SECRET`, decision 0036). A deployment is one cluster
and one team, so every signed-in person sees every sandbox and snapshot (decision 0044); `ownerId` on a
row records who made it, and the audit log records who did what.

| Method       | Path                       | Notes                                                              |
| ------------ | -------------------------- | ------------------------------------------------------------------ |
| `POST`       | `/api/auth/sign-up/email`  | `{ email, password, name }` → sets the session cookie              |
| `POST`       | `/api/auth/sign-in/email`  | `{ email, password }`                                              |
| `POST`       | `/api/auth/sign-out`       | Clears the cookie                                                  |
| `GET`        | `/api/auth/get-session`    | Who the cookie belongs to                                          |
| `POST`       | `/api/auth/sign-in/social` | `{ provider, callbackURL }` → GitHub redirect, `404` when unset    |
| `GET`        | `/api/auth/callback/{id}`  | The provider's callback; lands on `SPACES_AUTH_URL`                |
| `GET`        | `/api/v1/me`               | `{ principal, operator, role, admin, login }` for any credential   |
| `GET`/`POST` | `/api/v1/api-keys`         | List keys, or create one (`{ name }`) — the secret comes back once |
| `DELETE`     | `/api/v1/api-keys/{keyId}` | Revoke                                                             |

`/api/auth/*` is Better Auth's own surface: its envelopes and cookies, outside the `/api/v1` contract.

**Credentials, in order of precedence.** A valid session cookie wins; then a session-less bearer
token: the operator key (`SPACES_API_KEY`), which sees every sandbox and belongs to no account, or a
user API key, which carries its owner's role and otherwise sees only its owner's rows. Another
account's sandbox answers `404`, not `403`, so ids cannot be probed. Managing keys requires a session —
a key cannot mint another key, and the operator key answers `403`.

`login` is `{ "github": true | false }`: the alternative sign-in providers this deployment has
credentials for. The console reads it from `/me` because that is the one call it already makes, and
offers the GitHub button only when it is `true` — a server with no OAuth app answers `404` to
`/api/auth/sign-in/social`, so a button would be a dead end.

`GET /me` answers `{ ok, type: "me", principal, operator, role, admin, login }`. `operator` is true
only for the operator key; `role` is `admin` or `user` for an account (and `admin` for the operator
key); `admin` is the one field a console needs — it is true for both.

## Admin role

`role` lives on the account (Better Auth's admin plugin: `role`, `banned`, `banReason`, `banExpires`).
An account with `admin` sees every sandbox, as the operator key does, and passes the operator-only
gates (machine sizes, the routes below). Its rows are still stamped with its own id, and a ban stops
it signing in and using its keys. The operator key is unchanged and needs no account.

| Method   | Path                      | Notes                                                    |
| -------- | ------------------------- | -------------------------------------------------------- |
| `GET`    | `/api/v1/users`           | `search` (email contains), `limit`, `offset`; admin only |
| `POST`   | `/api/v1/users/{id}/role` | `{ role: "admin" \| "user" }`; admin only                |
| `POST`   | `/api/v1/users/{id}/ban`  | `{ reason? }`; admin only                                |
| `DELETE` | `/api/v1/users/{id}/ban`  | lift the ban; admin only                                 |

A user row on `/users` is `{ id, email, name, role, admin, banned, createdAt }`; the list is newest
first with `{ users, total, limit, offset }`. Demoting or banning the **last** admin is a `403` with
the reason, so a deployment cannot lock itself out; promote somebody else first. Every change is in
the audit log as `user.role_set`, `user.ban` or `user.unban` with the user id as the target.

**The first admin is `SPACES_ADMIN_EMAILS`.** A comma-separated list, empty by default: an address on
it is promoted to `admin` at boot (if the account already exists) and on its first sign-in or sign-up
otherwise, recorded once as `auth.admin_bootstrap`. After that the admin promotes the rest through
`/api/v1/users/{id}/role`, and the variable can be emptied — it never demotes anybody.

## Audit log

| Method | Path                 | Notes                                                                                        |
| ------ | -------------------- | -------------------------------------------------------------------------------------------- |
| `GET`  | `/audit-log`         | `action`, `actorId`, `targetType`, `targetId`, `result`, `since`, `until`, `limit`, `cursor` |
| `GET`  | `/audit-log/actions` | Action names this deployment has produced                                                    |

Append-only: there is no write, update or delete route. A user reads their own entries; the operator
key reads every entry. Pages use a keyset cursor (`at` + `id`, newest first), so paging does not shift
while the log grows. Every authenticated `POST`/`PUT`/`PATCH`/`DELETE` under `/api/v1` writes one row
with the actor (operator, user, or the key used), the action, the target, the result and status, the
request id, IP and user-agent, and the duration. Reads are not audited; signed-URL writes carry a token
rather than an actor (decision 0031).

## Traces

| Method | Path                | Notes                                                                                       |
| ------ | ------------------- | ------------------------------------------------------------------------------------------- |
| `GET`  | `/traces`           | Recent traces: `traceId`, `requestId`, `name`, `status`, `since`, `limit`                   |
| `GET`  | `/traces/{traceId}` | Every span of one trace, oldest first                                                       |
| `GET`  | `/traces/metrics`   | Request rate, error rate, p50/p95 latency and sandbox lifecycle durations (`windowMinutes`) |

Spans are stored in this server's own database (`SPACES_TRACES=off` disables them, and
`SPACES_OTLP_ENDPOINT` also ships them to a collector). Every request carries `spaces.request_id`, the
same value the audit log records, so a row in one can be found in the other. Scoped per user like
everything else. Decision 0032.

## Examples

```bash
K='Authorization: Bearer sk_local_dev'
J='content-type: application/json'
B=http://localhost:8787/api/v1

# a person, then a key that acts as them
curl -s -c jar -H "$J" -X POST http://localhost:8787/api/auth/sign-up/email \
  -d '{"email":"you@example.com","password":"correct-horse-battery","name":"You"}'
curl -s -b jar -H "$J" -X POST $B/api-keys -d '{"name":"ci"}'   # → { key: "spk_..." }
curl -s -H 'Authorization: Bearer spk_...' $B/sandboxes

# what this deployment can boot, then add a preset of your own
curl -s -H "$K" $B/machine-sizes
curl -s -H "$K" -H "$J" -X POST $B/machine-sizes \
  -d '{"name":"burst","vcpu":6,"memMib":12288,"diskGb":101}'

# create
curl -s -H "$K" -H "$J" -X POST $B/sandboxes -d '{"type":"small","ttlSeconds":900}'
curl -s -H "$K" -H "$J" -X POST $B/sandboxes -d '{"type":"burst","ttlSeconds":900}'

# retire a preset; sandboxes already at it keep working
curl -s -H "$K" -X DELETE $B/machine-sizes/burst

# run something
curl -s -H "$K" -H "$J" -X POST $B/sandboxes/bx_xxx/commands \
  -d '{"command":"uname -a"}'

# stream it instead of waiting
curl -sN -H "$K" -H "$J" -X POST $B/sandboxes/bx_xxx/commands \
  -d '{"command":"for i in 1 2 3; do echo $i; sleep 1; done","stream":true}'

# start a long job and poll it
curl -s -H "$K" -H "$J" -X POST $B/sandboxes/bx_xxx/commands \
  -d '{"command":"npm run build","detached":true}'
curl -s -H "$K" "$B/sandboxes/bx_xxx/commands/1234?stdoutOffset=0"

# write a file, read it back
curl -s -H "$K" -H "$J" -X PUT $B/sandboxes/bx_xxx/files \
  -d '{"path":"/home/user/hello.txt","content":"hi"}'
curl -s -H "$K" "$B/sandboxes/bx_xxx/files?path=/home/user/hello.txt"

# publish a port
curl -s -H "$K" -H "$J" -X POST $B/sandboxes/bx_xxx/host -d '{"port":3000}'

# snapshot it by name, then browse the frozen files
curl -s -H "$K" -H "$J" -X POST $B/saved-snapshots \
  -d '{"sandboxId":"bx_xxx","name":"my-base"}'
curl -s -H "$K" $B/snapshots/sn_xxx/tree
```
