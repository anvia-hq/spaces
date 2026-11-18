# 0042 — A control plane with many runtimes, joined by an outbound agent

- **Status:** accepted
- **Date:** 2026-11-18

## Context

The API did two jobs in one process: it was the control plane (accounts, keys, the store, the audit log, the console) and it drove the runtime (`msb`, on this machine or on one host over SSH, decision 0017). One API could therefore serve exactly one hypervisor.

Wanting more capacity, or machines in more places, meant either a second deployment with its own accounts and database, or more of the SSH path: the control plane holding an SSH key to every host, needing inbound reach to every host, paying about 81 ms per call, and opening one `ssh -L` per published port. None of that works for a runtime behind NAT or in someone else's network.

The seam to split on already exists. Every service reaches the machine through `SandboxDriver` (decision 0007), and every driver method is a request and a response: output is read by byte offset (decision 0012), not streamed. The one exception is the preview proxy, which dialled the hypervisor's loopback directly.

## Decision

**The control plane keeps the store and the HTTP API; a runtime is a small process, `spaces-agent`, that owns a real driver and dials out to the control plane.**

- **Registry.** A `runtimes` table. An admin registers a runtime (`POST /runtimes`) and is shown its token once; only the hash is stored (the same treatment as share codes, decision 0019). The token is the runtime's credential, revocable by rotating it.
- **The built-in runtime.** The API process still embeds a driver, registered as the runtime `local`. A deployment that does not register anything behaves exactly as before, and `SPACES_LOCAL_RUNTIME=off` turns the embedded one off for a control plane that only schedules.
- **Transport.** One outbound WebSocket per agent, `GET /runtime/connect`, authenticated with `Authorization: Bearer <token>`. The control plane never connects to a runtime, so a runtime needs no inbound port and the control plane needs no SSH key.
- **Protocol.** JSON frames. The control plane sends `call {id, method, args}` and the agent answers `result {id, ok, value | error}`. Every `SandboxDriver` method crosses the wire as the same call, so adding a method to the interface adds it to the protocol; the list of names lives in `@spaces/shared/runtime`, `driver/remote.ts` fails to compile if the interface and the list drift, and a test checks every name is a real method on both drivers. Bytes travel as `{"$b64": …}`. Driver errors keep their class (`DriverFailure`, `DriverUnsupported`), so the error envelope is identical whether the runtime is local or remote. The first agent frame is `hello` (protocol version, agent version, driver kind and capabilities, port range, bind address, public host); the answer is `welcome` or a close with a reason. A protocol mismatch is refused at the door, not discovered halfway through a call.
- **Liveness.** The agent sends a heartbeat every few seconds. A closed socket, or no heartbeat for three intervals, marks the runtime `offline` and fails its in-flight calls. Calls to a sandbox on an offline runtime answer `503 runtime_unavailable` (retryable), not `500`. A reconnect replaces the old connection.
- **Ownership is pinned.** A sandbox, and every snapshot made from it, records `runtime_id`. A disk lives on one runtime, so resume, fork, snapshot, restore and "create from a saved snapshot" all go to the runtime that holds the bytes. Moving a disk between runtimes is not offered.
- **Scheduling.** Only a create with no source is free to choose. A request may name a runtime (`runtime`: id or name). Otherwise the control plane picks among the runtimes that are online, not draining, under their `maxSandboxes` and able to hold the size. An agent reports its vCPU and memory in `hello` (the built-in runtime measures its own host); the control plane sums the machine sizes of each runtime's active sandboxes and a size must fit in what is left. Of those that fit, the one that would be least full after the placement wins, measured on the fuller of vCPU and memory, so a 32-core host takes work before an empty 4-core one and a memory-bound host is not judged by its cores. Ties go to fewer active sandboxes, then name. A runtime that reported nothing (a mock driver, or a host reached over SSH, which cannot be measured from here) is never refused for room and is chosen only when no measured runtime fits. No candidate answers `503 runtime_unavailable` and says why for each. A runtime can be put into `draining`: it keeps what it has and receives nothing new. A runtime that still has sandboxes or snapshots cannot be deleted.
- **Ports and previews go through the control plane.** Host ports are allocated per runtime, from the range the agent advertised, and a row's host port only means something on its runtime. The preview proxy asks the sandbox's runtime to dial the loopback port (`proxyHttp`), and the response body is streamed back in `chunk` frames, so a large download or an event stream is not buffered. Published ports still bind loopback on the runtime, as in decision 0022.
- **One codebase, two entrypoints.** The agent is `apps/api/src/agent.ts`, built from the same driver modules, so the API and the runtime cannot drift in how they drive `msb`. It imports no database code.
- **One token, not two.** A registration token exchanged for a per-runtime credential would add a step with nothing to gain: the per-runtime token is already the credential, and rotating it is the revocation.

## Consequences

- A runtime can sit anywhere that can make an outbound HTTPS connection. The control plane is the only front door: browsers, API clients, previews and transfers never talk to a runtime.
- A sandbox's data path now has one more hop. Local calls are unchanged; remote ones cost a WebSocket round trip on top of the driver call, in place of an SSH process per call.
- Bytes cross as base64 inside JSON, so a file is about a third larger on the wire. A call carries at most 120 MiB of encoded frame, which is about 90 MiB of file: Bun's WebSocket client drops the whole connection on a frame over 128 MiB (measured: a 90 MiB write crosses, a 96 MiB one closes the socket), and a dropped connection takes every other call on that runtime with it. The control plane therefore refuses a larger payload with `413 file_too_large` before sending, so on a remote runtime the effective ceiling is below `SPACES_TRANSFER_MAX` (100 MiB by default). Reads are not limited the same way, because results travel agent to control plane, where the socket's payload limit is 512 MiB. A binary frame, or chunked transfers, is the way past this if it ever matters.
- Streamed preview bodies are not flow-controlled. A slow browser on a fast upstream buffers in the control plane. It is acceptable for dev servers and the reason a preview is not a CDN.
- Preview traffic that is a WebSocket (hot reload) was not proxied before and still is not.
- **SSH to a guest** (decision 0015) still dials the runtime's published port directly. The answer now carries the runtime's advertised public host, and the loopback note names that host. Relaying SSH through the control plane is not part of this decision.
- Capacity is reservation, not usage. A sandbox holds its size from `provisioning` until it is stopped, whether or not it is busy, so the scheduler never looks at live CPU or memory and a runtime full of idle sandboxes is full. A stopped sandbox holds nothing, which means **resuming is checked too**: it answers `403` when its runtime has no room left, and the sandbox stays `archived`. That is a change for an existing deployment, whose host was never asked before; `SPACES_RUNTIME_OVERCOMMIT` (a factor, default 1) and `SPACES_RUNTIME_VCPU`/`SPACES_RUNTIME_MEM_MIB` (declare the numbers instead of measuring them) are the valves. Detected memory is the host's total less `SPACES_RUNTIME_RESERVE_MIB` (1 GiB), since the host needs some.
- Disk is not scheduled. A root disk is sparse (decision 0041), so the sum of `diskGb` says little about what is actually written.
- Two concurrent creates can choose the same runtime before either row is counted, so `maxSandboxes` and the room check are soft by about the concurrency.
- A runtime that is offline for long leaves its sandboxes in whatever state they were in. The row is the record; when the agent returns it reconnects to the same machines. Nothing is reconciled automatically in this version.
- The reaper skips sandboxes on an offline runtime instead of marking them failed, and retries at the next sweep.
- Deleting a sandbox or a snapshot on an offline runtime is refused with `503`, not accepted and left to leak: the row is the only record of a machine and a disk that still exist. The cost is that a runtime that is gone for good cannot be emptied from the API; its rows have to be cleaned in the database. A "forget this runtime" operation is the follow-up if that proves common.
- `SPACES_MSB_HOST` and the SSH transport stay, as the built-in runtime's way of reaching a single remote host. They are no longer the way to add a second one.
- New surface, recorded here and in `docs/api.md`: `/runtimes` routes, `runtimeId` on a sandbox, `runtime` on create, error code `runtime_unavailable` (503), `GET /runtime/connect`, and `runtimes: { online, total }` on `/health`, whose `driver` and `capabilities` now describe the built-in runtime only (`"none"` when it is off).
- The migration adds `runtime_id` (default `local`) to `sandboxes` and `snapshots`, so an existing deployment is a one-runtime deployment with no data movement.

## Alternatives considered

- **More SSH.** A registry over SSH hosts would have been less work and the wrong foundation: it needs inbound reach and a standing credential per host, and it cannot onboard a runtime with one command.
- **The control plane dials the agent.** Needs an inbound port on every runtime. Outbound-only is what makes NAT and customer networks work.
- **gRPC or HTTP/2 between them.** More machinery for the same request/response shape; a WebSocket carries both calls and the streamed preview and needs nothing but Bun and Hono, which are already here.
- **A new workspace for the agent.** Would copy or re-export `microsandbox.ts` (about a thousand lines) to avoid a second `bun run` entrypoint.
- **Moving a disk between runtimes.** Disks are tens of gigabytes. Pinning is simple and honest; migration is a feature, not a fix.
- **Rescheduling a sandbox when its runtime is down.** Its disk is on that runtime. There is nothing to move.
