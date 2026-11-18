# 0038 — Create a sandbox from a saved snapshot

- **Status:** accepted
- **Date:** 2026-11-17

## Context

`POST /sandboxes` has always accepted `from`, and it already forks a live sandbox's disk. A client needs
more than a fork: it runs a setup script once, saves the resulting environment under a name, and starts
later sandboxes from it. Saved snapshots already point at a snapshot artifact (`snapshotId`), and that
artifact already carries the driver's disk reference (`driverRef`), so the missing piece was resolving
that pair and booting it.

The spec also allows a `bsh_` share code in `from`. Share codes exist, but they are a separate
capability (0019); this change does not add a deploy path for them.

The client manages the 72-hour lifetime of its saved snapshots by deleting them through the snapshot routes.
Spaces must not grow a hidden TTL for rows a client is responsible for.

## Decision

`from` resolves in two steps, inside the caller's scope:

1. A live sandbox id with a `driverRef` keeps the existing behaviour: **fork** its disk.
2. Otherwise the value is a **saved-snapshot name** the caller can see. It must be `status: ready`,
   have a `snapshotId`, and that artifact must be visible, `state: ready`, and have a `driverRef`.
   The new sandbox then **restores** that disk.

A saved snapshot is never treated as a sandbox id, and a resolved source is carried through
provisioning instead of being looked up again. If the driver cannot restore the disk, the sandbox ends
in `error`; it is never silently cold-booted from the base image.

The driver seam gains one operation:

```ts
restore(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>
```

`microsandbox` implements it as `msb restore <group>:<member> --name <sandboxId> -c … -m … [-p …]`, so
the requested machine size and host ports apply at boot. `restoreTemporary` stays the separate,
throwaway path used for browsing snapshot files (0018); it is not reused here because it leaves a
sandbox behind and its configuration, not the caller's request, would be forked.

The error split is honest and does not distinguish "does not exist" from "not yours":

- `404 snapshot_not_found` — unknown name, another account's name, a share code, a saved snapshot
  without an artifact, a dangling artifact, or an artifact without a disk reference.
- `409 snapshot_not_ready` — the saved snapshot is still `saving` or `failed`, or its artifact is not
  `ready`.

No schema change is needed: `saved_snapshots.snapshot_id` and `snapshots.driver_ref` already exist.

## Consequences

- One `from` field now covers both immediate forks and later, durable environments, without a new
  route or a new request shape.
- A restore is one boot: `msb restore` takes the requested size and ports directly, so there is no
  resize-and-restart step. On the development host (`msb` 0.7.15) a 2 vCPU / 4 GiB restore with one
  published port returned in 0.31 s. Fork stays cheaper for a live source, which is why both paths
  exist.
- The saved snapshot is read-only in this flow. Creating, changing, stopping, resuming or deleting
  the new sandbox leaves the name and artifact usable; tests pin that. The reverse is also true:
  deleting the saved snapshot after a restore leaves the new sandbox running, because `msb restore`
  booted its own disk. Verified on the development host by removing the artifact while the restored
  sandbox answered commands.
- A caller that forgets to delete its saved snapshots keeps them forever. That is deliberate: lifetime
  is the caller's policy, not a store side effect.
- A future driver must implement `restore`; the interface makes that a compile error rather than a
  runtime surprise.
- Share codes still answer `404` on create. Supporting them would need a decision about who owns the
  resulting sandbox and how share use is counted; nothing today asks for it.

## Alternatives considered

- **Restore a temporary sandbox, fork it, then delete the temporary.** Rejected: two sandboxes per
  create, a cleanup path that can strand one, and `msb fork` copies the temporary's configuration
  rather than the requested size and ports.
- **Export the snapshot and `msb create` from the archive.** Rejected: moves the whole disk through
  the API host, needs temporary space, and turns a metadata lookup into a copy.
- **Cold-boot when the source is missing or unusable.** Rejected: the client asked for an
  environment and would silently get a different one — the same failure `from` exists to prevent.
- **Add a TTL or expiry sweep for saved snapshots.** Rejected: the client already owns deletion, and
  a hidden timer would delete an environment out from under a running campaign.
