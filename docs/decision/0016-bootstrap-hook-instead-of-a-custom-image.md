# 0016 — A bootstrap hook instead of a custom image

- **Status:** accepted
- **Date:** 2026-11-15

## Context

A machine that arrives with sshd, Docker and a desktop stack is an Ubuntu VM with all of it already
installed. Guests here boot a stock OCI image (`alpine`) which has none of that. Two options: publish
and maintain a custom image, or converge a stock image at boot.

A custom image means owning a Dockerfile, a registry, a build pipeline, a tag policy and a rebuild for
every base-image CVE — the exact burden that made the Firecracker rootfs a liability (0001).

## Decision

`SPACES_BOOTSTRAP` — a shell snippet run once after boot, before the sandbox is marked ready. Its
outcome is recorded as a `sandbox.bootstrap` event; a failure is logged and **never** blocks the
sandbox from becoming ready.

## Consequences

- The default stays a fast, tiny Alpine boot (~250 ms) for people who want a sandbox, not an Ubuntu box.
- Anyone who wants sshd/Docker/the kitchen sink sets one environment variable and gets it, with the
  recipe in the docs.
- Cost is paid per boot, not per release: enabling Docker adds a ~100 MB download to each new sandbox.
  Mitigated by stopping/resuming rather than recreating, and by the fact that a snapshot preserves the
  installed packages.
- The snippet runs as root in the guest. It is operator-supplied configuration, and it is the operator's
  trust boundary.

## Alternatives considered

- **Custom OCI image.** Rejected: registry and CVE treadmill for a marginal boot-time win.
- **Bake tools into the default image via msb's rootfs hooks.** Rejected: still a per-release pipeline.
