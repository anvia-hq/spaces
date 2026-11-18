import type { SnapshotRow } from "@spaces/db";
import { newId } from "@spaces/shared/errors";
import { SANDBOX_WORKDIR } from "@spaces/shared/files";
import { now, store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import { driverFor } from "../driver/service.ts";
import type { SandboxDriver } from "../driver/types.ts";
import { mintTransferToken } from "../files/sign.ts";
import { requireSandbox } from "../sandboxes/service.ts";
import { withSpan } from "../traces/tracer.ts";
import type { SnapshotRowLike } from "./types.ts";

/** Root the snapshot tree is relative to: the sandbox workdir. */
const TREE_ROOT = SANDBOX_WORKDIR;

/** Entries beyond this are dropped and the answer is marked truncated. */
const TREE_LIMIT = 20_000;

export function shapeSnapshot(row: SnapshotRow) {
  return {
    id: row.id,
    sandboxId: row.sandboxId,
    name: row.name,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
    sizeBytes: row.sizeBytes,
  };
}

export async function listSnapshots(sandboxId?: string) {
  return (await store.listSnapshots(sandboxId)).map(shapeSnapshot);
}

export async function latestSnapshot(sandboxId: string) {
  const [latest] = await store.listSnapshots(sandboxId);

  if (!latest) throw new ServiceError("not_found", "no snapshots for this sandbox");

  return shapeSnapshot(latest);
}

export async function snapshotSandbox(id: string, name?: string) {
  return withSpan("snapshot.create", { "spaces.sandbox_id": id }, () => createInner(id, name));
}

async function createInner(id: string, name?: string) {
  const sandbox = await requireSandbox(id);
  const driver = driverFor(sandbox.runtimeId);
  const runtimeId = sandbox.runtimeId;
  const snapshotId = newId("sn");
  await store.insertSnapshot({
    id: snapshotId,
    sandboxId: id,
    name: name ?? null,
    state: "creating",
    runtimeId,
  });
  await store.event(id, "snapshot.creating", { snapshotId });

  try {
    const { ref, sizeBytes } = await driver.snapshot(id, snapshotId);
    await store.removeSnapshot(snapshotId);
    await store.insertSnapshot({
      id: snapshotId,
      sandboxId: id,
      name: name ?? null,
      state: "ready",
      sizeBytes,
      driverRef: ref,
      runtimeId,
    });
    await store.update(id, { snapshotAt: now() });
    await store.event(id, "snapshot.ready", { snapshotId, sizeBytes });

    return (await store.getSnapshot(snapshotId))!;
  } catch (error) {
    await store.removeSnapshot(snapshotId);
    await store.insertSnapshot({
      id: snapshotId,
      sandboxId: id,
      name: name ?? null,
      state: "error",
      runtimeId,
    });
    const message = error instanceof Error ? error.message : String(error);
    await store.event(id, "snapshot.error", { snapshotId, message });
    throw new ServiceError("internal", message);
  }
}

/** Boot a snapshot in a throwaway sandbox, run fn, then always tear it down. */
async function withSnapshotRestore<T>(
  snapshot: SnapshotRowLike,
  fn: (ref: string, driver: SandboxDriver) => Promise<T>,
): Promise<T> {
  if (!snapshot.driverRef) {
    throw new ServiceError("not_found", "snapshot has no stored artifact");
  }

  if (snapshot.state !== "ready") {
    throw new ServiceError("sandbox_not_ready", `snapshot is ${snapshot.state}`);
  }

  const driver = driverFor(snapshot.runtimeId);
  const name = newId("browse");
  let ref: string | null = null;
  try {
    ref = (await driver.restoreTemporary(snapshot.driverRef, name)).ref;
    return await fn(ref, driver);
  } finally {
    if (ref) await driver.removeTemporary(ref).catch(() => {});
  }
}

async function requireSnapshot(snapshotId: string): Promise<SnapshotRowLike> {
  const row = await store.getSnapshot(snapshotId);

  if (!row) throw new ServiceError("not_found", `no snapshot ${snapshotId}`);

  return row;
}

/**
 * Flat file listing of a snapshot, cached after the first read: a manifest is
 * immutable once captured, so it is stored on the snapshot row.
 */
export async function snapshotTree(snapshotId: string) {
  const snapshot = await requireSnapshot(snapshotId);

  if (snapshot.manifest) {
    return shapeTree(snapshot, snapshot.manifest);
  }

  const entries = await withSnapshotRestore(snapshot, (ref, driver) =>
    driver.listSnapshotTree(ref, TREE_ROOT, TREE_LIMIT + 1),
  );

  await store.setSnapshotManifest(snapshotId, entries.slice(0, TREE_LIMIT));
  return shapeTree(snapshot, entries);
}

function shapeTree(
  snapshot: SnapshotRowLike,
  entries: { path: string; kind: string; size?: number }[],
) {
  const truncated = entries.length > TREE_LIMIT;
  const kept = truncated ? entries.slice(0, TREE_LIMIT) : entries;
  const files = kept.filter((e) => e.kind === "file");
  return {
    type: "snapshot.tree" as const,
    snapshotId: snapshot.id,
    sandboxId: snapshot.sandboxId,
    generation: 1,
    treeAvailable: true,
    truncated,
    fileCount: files.length,
    totalSizeBytes: files.reduce((sum, f) => sum + (f.size ?? 0), 0),
    entries: kept,
  };
}

/**
 * Bytes of one path inside a snapshot. A directory is returned as a tar, a file
 * as its raw content, so the caller's `Range` handling stays uniform.
 */
export async function snapshotFileEntry(
  snapshotId: string,
  path: string,
): Promise<{ bytes: Uint8Array; kind: "file" | "dir"; name: string }> {
  const snapshot = await requireSnapshot(snapshotId);
  // Stay inside the tree root: strip leading slashes and any `..` segment.
  const relative = path
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  const target = relative ? `${TREE_ROOT}/${relative}` : TREE_ROOT;

  const entry = await withSnapshotRestore(snapshot, (ref, driver) =>
    driver.readSnapshotEntry(ref, target),
  );
  return {
    bytes: entry.bytes,
    kind: entry.kind,
    name: relative.split("/").pop() || "snapshot",
  };
}

/** Snapshot deletion, both by id and for a whole sandbox. */
export async function deleteSnapshot(snapshotId: string) {
  const row = await store.getSnapshot(snapshotId);

  if (!row) throw new ServiceError("not_found", `no snapshot ${snapshotId}`);

  if (row.driverRef)
    await driverFor(row.runtimeId)
      .destroySnapshot(row.driverRef)
      .catch(() => {});

  await store.removeSnapshot(row.id);
  // A saved snapshot cannot outlive its artifact: drop the name and its codes.
  const orphaned = await store.deleteSavedSnapshotsBySnapshotId(row.id);
  const deleted: { id: string; removedSavedSnapshots?: string[] } = { id: row.id };

  if (orphaned.length > 0) deleted.removedSavedSnapshots = orphaned;

  return deleted;
}

export async function deleteSandboxSnapshots(sandboxId: string) {
  await requireSandbox(sandboxId);
  const rows = await store.listSnapshots(sandboxId);
  for (const row of rows) {
    if (row.driverRef)
      await driverFor(row.runtimeId)
        .destroySnapshot(row.driverRef)
        .catch(() => {});

    await store.removeSnapshot(row.id);
    await store.deleteSavedSnapshotsBySnapshotId(row.id);
  }
  return { sandboxId, deleted: rows.length };
}
/** Where a snapshot download token resolves to a tar stream. */
export const SNAPSHOT_DOWNLOAD_PATH = "/api/v1/_snapshot-download";

/** A short-lived signed URL that streams this snapshot's workdir as a tar. */
export async function mintSnapshotDownload(snapshotId: string, origin: string) {
  const snapshot = await snapshotTree(snapshotId); // 404s when unknown
  const token = await mintTransferToken({
    m: "GET",
    s: snapshot.sandboxId,
    p: `${SNAPSHOT_DOWNLOAD_PATH}/${snapshotId}`,
    e: Math.floor(Date.now() / 1000) + 900,
  });

  return {
    snapshotId,
    sandboxId: snapshot.sandboxId,
    totalSizeBytes: snapshot.totalSizeBytes,
    signedUrl: `${origin}/api/v1/_transfer/${token}`,
    expiresInSeconds: 900,
  };
}
