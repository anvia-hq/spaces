# 0001 — microsandbox is the only runtime

- **Status:** accepted (supersedes the Firecracker driver)
- **Date:** 2026-11-15

## Context

The first implementation drove **Firecracker** on a bare-metal AMD host (v1.18.0, KVM). It worked and
it was measured: 2067 ms to a usable guest, 217 MiB idle RSS, 35–43 ms per command through the API,
and four 4 vCPU / 8 GiB microVMs saturating 16 threads with zero steal.

Three things blocked it as a product:

1. **Development machine vs. runtime machine.** The editor is an Apple M4; Firecracker needs Linux/KVM.
   Every iteration crossed an SSH hop to a remote host.
2. **Rootfs ownership.** Firecracker needs a kernel and a rootfs we build and maintain (we had a
   hand-built Alpine 3.8). Every image question became our problem.
3. **A guest agent to write.** Command execution needed a vsock agent (Go, `fcvsock.py` on the host),
   which is a piece of infrastructure with its own lifecycle.

msb (libkrun) solves all three: OCI images off a registry, KVM on Linux and **Hypervisor.framework on
Apple Silicon**, and an agent already inside the VM.

## Decision

Support **microsandbox only**. Delete the Firecracker driver, the guest agent, the vsock plumbing and
the provisioning scripts rather than keeping two backends.

## Consequences

- Boot drops from 2067 ms to **228–271 ms** and exec through the API from 35–43 ms to **20–45 ms**.
- The API runs on the same machine as the hypervisor, removing a network hop from every command.
- `image: alpine` means a real Alpine from Docker Hub, not a rootfs we own.
- Native copy-on-write forks; `msb restore` enables snapshot browsing (see 0018).
- We inherit msb's constraints: no reflink on `ext4` (forks become sparse copies), and adding a port
  to a _running_ microVM requires a restart (see 0014).
- Latency is now dominated by the VMM, not the transport: the remaining lever is keeping `msb` local.

## Alternatives considered

- **Keep both drivers behind the existing seam.** Rejected: two code paths for every feature forever
  (files, ports, SSH, snapshots) with no user-visible benefit. The seam stays — see 0007 — because it
  is still the right shape for testing.
- **Port Firecracker to macOS.** Not possible; it is KVM-only.
