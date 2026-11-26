# 0047 — Synchronous create and create-time provisioning

- **Status:** accepted
- **Date:** 2026-11-26

## Context

`POST /sandboxes` historically returned `202 Accepted` immediately while the microVM booted in the
background, leaving every client to write a poll loop even though local and KVM microVMs reach
`ready` in ~250 ms. Furthermore:

- `hostedPorts` and `files` were accepted on `POST /sandboxes` and silently ignored
  ([0021](./0021-extensions-and-honest-refusals.md)). Publishing a port outside
  `SPACES_PREPUBLISH_PORTS` after boot forced a microVM restart
  ([0014](./0014-port-publishing-pre-publish-and-restart.md)).
- `setupScript` ran asynchronously after `ready` with its outcome visible only by polling
  `/events`, leaving callers with no structured status field on the sandbox resource.

## Decision

1. **Optional synchronous create (`wait: true`):**
   - `POST /sandboxes` accepts `wait` (default `false`) and `waitTimeoutSeconds` (1–120, default
     `30`).
   - With `wait: false`, behaviour is unchanged (`202` in `provisioning`).
   - With `wait: true`, the handler awaits provisioning up to `waitTimeoutSeconds`:
     - If the sandbox reaches `ready`, it answers **`201 Created`** with the ready sandbox.
     - If provisioning fails (`state: "error"`), it answers `500` with the failure message while
       keeping the errored row inspectable.
     - If the wait budget elapses while still provisioning, it answers **`202 Accepted`** with the
       current transitional sandbox so the caller can continue polling.
2. **Pre-boot `hostedPorts`:**
   - Requested `hostedPorts` are reserved before `driver.create` / `restore` / `fork` and stored as
     `explicit: true` in `sandbox_ports` alongside any remaining `SPACES_PREPUBLISH_PORTS`.
   - Because the mappings are passed into the initial boot, no microVM restart is needed. Calling
     `POST /sandboxes/{id}/host` later for a pre-hosted port only returns its preview URL without
     restarting.
   - Requesting `hostedPorts` on a runtime with port publishing disabled answers `501` up front.
3. **Create-time `files`:**
   - Each entry is validated with the same lexical path boundary (`/home/user` or `/tmp`) and 5 MiB
     per-file cap as `PUT /files`, plus a 20 MiB total cap across up to 32 files, so bad paths fail
     synchronously with `400`.
   - Files are written via `driver.writeFile` after boot and bootstrap, **before** the sandbox
     transitions to `ready`. A write failure marks the sandbox `error`.
4. **Structured `setupStatus` and `setupError`:**
   - `sandboxes` stores `setup_status` (`pending | running | done | failed | null`) and
     `setup_error` (nullable text), exposed on `Sandbox` and shown in the console's Machine panel.
   - `setupScript` still starts after `ready` so a slow script does not block `wait: true` or the
     sandbox becoming reachable.

## Consequences

- Scripts and agents can boot a ready sandbox with files and ports in a single HTTP request.
- Callers omitting `wait`, `hostedPorts`, and `files` observe zero breaking changes.
- Pre-boot `hostedPorts` eliminates the restart penalty for custom application ports.
