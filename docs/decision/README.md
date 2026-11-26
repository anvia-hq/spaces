# Engineering decisions

Why this codebase is shaped the way it is. Each record is a decision that was actually contested —
where the obvious approach was tried, measured, or rejected — not a description of the code.

Format: context, decision, consequences (including what it costs), and the alternatives that were ruled
out. Numbers quoted are measured, not estimated.

| #                                                                  | Decision                                                               | Status                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------- | ---------------------------------------- |
| [0001](./0001-microsandbox-as-the-only-runtime.md)                 | microsandbox is the only runtime                                       | accepted, supersedes Firecracker         |
| [0002](./0002-the-api-is-its-own-contract.md)                      | The API is its own contract                                            | accepted                                 |
| [0003](./0003-no-saas-account-surface.md)                          | No account or SaaS surface                                             | accepted                                 |
| [0004](./0004-monorepo-with-bun-workspaces.md)                     | One monorepo, Bun workspaces, shared Zod contracts                     | accepted                                 |
| [0005](./0005-zod-validation-and-error-envelope.md)                | Validate everything with Zod, answer in one error envelope             | accepted                                 |
| [0006](./0006-drizzle-sqlite-with-boot-migrations.md)              | Drizzle over bun:sqlite, migrations at boot                            | accepted                                 |
| [0007](./0007-driver-seam.md)                                      | `SandboxDriver` is the only seam between HTTP and infrastructure       | accepted                                 |
| [0008](./0008-file-operations-ride-on-exec.md)                     | File operations ride on `exec`, not `msb copy`                         | accepted                                 |
| [0009](./0009-two-layer-path-safety.md)                            | Two layers of path safety; symlinks are never followed on delete       | accepted                                 |
| [0010](./0010-signed-transfer-urls-served-by-the-api.md)           | Signed transfer URLs are served by the API, not the guest              | accepted                                 |
| [0011](./0011-snapshots-are-disk-only.md)                          | Snapshots capture the disk, not memory                                 | accepted                                 |
| [0012](./0012-background-commands-and-offset-reads.md)             | Background commands use `setsid`; logs read by byte offset             | accepted                                 |
| [0013](./0013-guest-networking-on-by-default.md)                   | Guests boot with networking enabled                                    | accepted                                 |
| [0014](./0014-port-publishing-pre-publish-and-restart.md)          | Port publishing: pre-publish, and disclose restarts                    | accepted                                 |
| [0015](./0015-ssh-by-provisioning-sshd-in-the-guest.md)            | SSH by provisioning sshd inside the guest                              | accepted                                 |
| [0016](./0016-bootstrap-hook-instead-of-a-custom-image.md)         | A bootstrap hook instead of a custom image                             | accepted                                 |
| [0017](./0017-remote-msb-over-ssh.md)                              | Driving `msb` on another machine over SSH                              | accepted                                 |
| [0018](./0018-browsing-snapshots-with-a-throwaway-vm.md)           | Browsing a snapshot by booting a throwaway VM                          | accepted                                 |
| [0019](./0019-saved-snapshots-and-share-codes.md)                  | Saved snapshots, and share codes stored as hashes                      | accepted                                 |
| [0020](./0020-stops-and-usage-from-the-event-log.md)               | Stop operations as rows, usage derived from the event log              | accepted                                 |
| [0021](./0021-extensions-and-honest-refusals.md)                   | Additive extensions and honest refusals                                | accepted                                 |
| [0022](./0022-security-posture-single-key-and-loopback.md)         | One bearer key, loopback by default, tokens where a browser needs them | accepted                                 |
| [0023](./0023-web-console-design-decisions.md)                     | Console: local-first auth, one accent, inline confirmation             | accepted                                 |
| [0024](./0024-commit-the-generated-route-tree.md)                  | Commit the generated route tree                                        | accepted                                 |
| [0025](./0025-deploy-as-one-process.md)                            | Deploy as one process: the API serves the console                      | accepted                                 |
| [0026](./0026-console-on-shadcn-and-reui.md)                       | Console on shadcn/ui primitives and the free ReUI set                  | accepted, supersedes parts of 0023       |
| [0027](./0027-module-layout.md)                                    | Feature code in modules, on both sides                                 | accepted                                 |
| [0028](./0028-accounts-and-api-keys.md)                            | Accounts, API keys, and one owner per resource                         | accepted                                 |
| [0029](./0029-oxlint-and-oxfmt.md)                                 | One lint and format gate: oxlint and oxfmt, on one written rule set    | accepted                                 |
| [0030](./0030-postgres.md)                                         | Postgres, and how the old SQLite data gets there                       | accepted                                 |
| [0031](./0031-audit-log.md)                                        | An audit log that cannot be forgotten, and cannot be edited            | accepted                                 |
| [0032](./0032-tracing.md)                                          | Tracing that ships with the server, not with a vendor                  | accepted                                 |
| [0033](./0033-login-first-console.md)                              | Login-first console: gate at the root, one sidebar                     | accepted                                 |
| [0034](./0034-operator-defined-machine-sizes.md)                   | Machine sizes are operator-owned data                                  | accepted                                 |
| [0035](./0035-starter-guest-image.md)                              | A starter guest image with the toolchain baked in                      | accepted, narrows 0016                   |
| [0036](./0036-github-login-from-the-environment.md)                | GitHub sign-in, configured from the environment                        | accepted                                 |
| [0037](./0037-admin-role-for-operators.md)                         | The admin role: an operator is an account, not only a secret           | accepted, extends 0028 and 0034          |
| [0038](./0038-create-from-a-saved-snapshot.md)                     | Create a sandbox from a saved snapshot                                 | accepted                                 |
| [0039](./0039-stock-shadcn-and-a-type-scale.md)                    | Stock shadcn/ui, no ReUI, and a real type scale                        | accepted, supersedes parts of 0026       |
| [0040](./0040-anvia-color-and-theme.md)                            | Color and theme follow the Anvia design system                         | accepted                                 |
| [0041](./0041-a-sandbox-s-root-disk-is-its-machine-size-s-disk.md) | A sandbox's root disk is its machine size's disk                       | accepted                                 |
| [0042](./0042-control-plane-and-runtimes.md)                       | A control plane with many runtimes, joined by an outbound agent        | accepted, extends 0007, narrows 0017     |
| [0043](./0043-install-a-runtime-with-one-command.md)               | A runtime is installed by one command, run on the machine              | accepted, builds on 0042                 |
| [0044](./0044-a-cluster-is-one-team.md)                            | A cluster is one team, and nothing here is held back                   | accepted, narrows 0028                   |
| [0045](./0045-the-operator-console.md)                             | The operator's console: one Cluster page, and history the server keeps | accepted, builds on 0034, 0042, 0044     |
| [0046](./0046-trim-compat-surface-and-harden-sandboxes-api.md)     | Trim SaaS compatibility leftovers and harden the sandbox API           | accepted, supersedes parts of 0019, 0021 |
| [0047](./0047-synchronous-create-and-create-time-provisioning.md)  | Synchronous create and create-time provisioning                        | accepted, builds on 0014, 0046           |
| [0048](./0048-per-sandbox-network-policy.md)                       | Per-sandbox network egress policy                                      | accepted, builds on 0013                 |

## Reading order

New to the project, read **0001 → 0002 → 0007** first: the runtime choice, the contract, and the seam
that keeps the two apart. Everything else follows from those three.

Changing a specific area? Jump straight to the relevant record:

| Working on                           | Read                               |
| ------------------------------------ | ---------------------------------- |
| Runtime, images, boot                | 0001, 0013, 0016, 0035             |
| API surface, status codes, errors    | 0002, 0003, 0005, 0021, 0046, 0047 |
| Files, transfers, path handling      | 0008, 0009, 0010                   |
| Commands, processes, streaming       | 0012                               |
| Snapshots, forks, sharing            | 0011, 0018, 0019, 0038             |
| Networking, ports, SSH, remote hosts | 0013, 0014, 0015, 0017, 0022, 0048 |
| Storage, metering, state             | 0006, 0020, 0030                   |
| Machine sizes, capacity, presets     | 0034, 0037                         |
| The console                          | 0021, 0023, 0026, 0024, 0039       |
| The operator's console               | 0045, 0042, 0034, 0037             |
| Deploying it somewhere               | 0025, 0017, 0022, 0042             |
| Runtimes, scheduling, the agent      | 0042, 0043, 0007, 0017             |
| Where a file goes                    | 0027                               |
| Auth, keys, who sees which sandbox   | 0028, 0044, 0037                   |
| Audit log, who did what              | 0031                               |
| Tracing, spans, metrics              | 0032                               |
| Style, lint rules, formatting        | 0029                               |
| Storage engine, moving data          | 0030                               |

## Not covered here

This directory records decisions, not instructions. For what the project is see the [README](../../README.md); for building and
testing it see [DEVELOPMENT.md](../../DEVELOPMENT.md); for the endpoint reference see [docs/api.md](../api.md); for how the mechanisms
work see [docs/internals.md](../internals.md).

No decision here has been superseded except 0001, which replaced the original Firecracker driver (that
record explains why the codebase carries no Firecracker code despite having started there), and the parts
of 0023 that 0026 rewrites: the primitive kit, the token names, and inline confirmation for destructive
actions that destroy a disk. 0039 replaces the ReUI and one-size parts of 0026. 0035 narrows 0016 rather than replacing it: a bootstrap snippet is still the
per-deployment hook, and the starter image is now the other supported answer for a toolchain. 0044 narrows 0028: rows still
record their owner, but on a cluster everyone who can sign in sees every row, so ownership is attribution and no longer a filter. 0046 supersedes the snapshot share-code part of 0019 and the hardcoded refusal routes of 0021.
