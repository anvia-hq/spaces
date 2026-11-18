# 0041 — A sandbox's root disk is its machine size's disk

- **Status:** accepted
- **Date:** 2026-11-17

## Context

A machine size has `diskGb` (51 for `small` and `default`, 111 for `large`, 251 for `xlarge`), but the driver passed `msb create` only the CPU count and memory. Every sandbox got msb's default 4 GiB root disk. A warm saved environment (installed dependencies and browsers) took 3.5 GiB of it, so every thread started from that snapshot had about 370 MB free and ran into `ENOSPC` within minutes, which surfaced in the client as "Durable storage failed … cannot rollback".

## Decision

- `create` passes `--root-disk <diskGb>G`. Checked on the host with msb 0.7.15: a sandbox created with `--root-disk 51G` reports a 51G root disk, and a snapshot of it restores at 51 GiB, with its files.
- `restore` and `fork` take the disk size of the snapshot or parent, since msb has no way to resize it. A snapshot made from a 4 GiB sandbox stays 4 GiB, so an environment saved before this has to be saved again from a sandbox created after it.

## Consequences

- A change to a size's `diskGb` applies to sandboxes created after it, not to existing ones.
- The disk is a sparse file on the host, so a 51 GiB root disk does not use 51 GiB until it is written.
