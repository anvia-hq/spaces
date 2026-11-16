# 0007 — `SandboxDriver` is the only seam between HTTP and infrastructure

- **Status:** accepted
- **Date:** 2026-11-15

## Context

Once microsandbox became the only runtime (0001), an interface between the routes and `msb` looked
like unnecessary indirection. But the API layer also needed to be testable without a hypervisor, and
`msb` knowledge (ref formats, `--no-stdin`, quoting) must not leak into route handlers.

## Decision

`apps/api/src/driver/types.ts` defines `SandboxDriver`: create/resume/fork/stop/destroy, exec,
snapshot, the file operations, ports, SSH-adjacent helpers and the process runtime. Two
implementations:

- **`microsandbox`** (default) — shells out to `msb`, locally or over SSH.
- **`mock`** — in-process fixture; `SPACES_DRIVER=mock` on machines with no hypervisor. Operations it
  cannot model throw `DriverUnsupported` → `501 provider_not_configured`, mapped explicitly rather
  than exploding as a 500.

`runRemote()` is the single transport: `SPACES_MSB_HOST=local` spawns directly, anything else goes
over a multiplexed SSH connection.

## Consequences

- Route handlers read as product logic; `msb` flags appear in exactly one file.
- Ref formats are contained: `msb:<name>` for a machine, `snap:<group>:<member>` for a snapshot.
- The mock keeps CI honest about _which_ operations genuinely need a hypervisor.
- Cost: the interface is wide (≈40 methods) because the surface is wide. A narrower seam would push
  `msb` knowledge back into the routes.
- Every new capability must be added twice (real + unsupported). That friction is the price of the
  capability being explicitly unavailable rather than mysteriously broken.

## Alternatives considered

- **Call `msb` directly from routes.** Rejected: untestable and unreadable.
- **Use a general process/RPC abstraction.** Rejected: the seam exists to name sandbox operations,
  not to generalise exec.
