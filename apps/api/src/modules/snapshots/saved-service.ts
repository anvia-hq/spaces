import { createHash } from "node:crypto";
import { newId } from "@spaces/shared/errors";
import { iso, store } from "../../db.ts";
import type { SnapshotShareRow } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import { currentOwnerId } from "../../scope.ts";
import { driverFor } from "../driver/service.ts";
import { requireSandbox } from "../sandboxes/service.ts";
import { snapshotSandbox } from "./service.ts";

const SAVED_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const RESERVED_NAMES = new Set(["latest", "tree", "pull", "rm", "save", "current", "self", "new"]);

export function savedSnapshot(row: {
  name: string;
  status: string;
  error: string | null;
  sourceSandboxId: string;
  snapshotId: string | null;
  type: string | null;
  sizeBytes: number | null;
  createdAt: Date;
}) {
  const shaped: {
    name: string;
    status: "saving" | "ready" | "failed";
    error?: string;
    sourceSandboxId: string;
    snapshotId?: string;
    type?: string;
    sizeBytes?: number;
    createdAt: string;
  } = {
    name: row.name,
    status: row.status as "saving" | "ready" | "failed",
    sourceSandboxId: row.sourceSandboxId,
    createdAt: row.createdAt.toISOString(),
  };

  if (row.error) shaped.error = row.error;

  if (row.snapshotId) shaped.snapshotId = row.snapshotId;

  if (row.type) shaped.type = row.type;

  if (row.sizeBytes !== null) shaped.sizeBytes = row.sizeBytes;

  return shaped;
}

export async function listSavedSnapshots(filter?: { name?: string; namePrefix?: string }) {
  return (await store.listSavedSnapshots(filter)).map(savedSnapshot);
}

/** What a wallet pays for saved snapshots. Personal wallets include 10. */
export async function savedSnapshotAllowance() {
  const used = (await store.listSavedSnapshots()).length;
  const included = 10;
  const extra = Math.max(0, used - included);
  return {
    org: null,
    orgName: null,
    included,
    free: included,
    used,
    extra,
    extraMonthlyDollars: Math.round(extra * 1.68 * 1e6) / 1e6,
    extraDailyDollars: Math.round(extra * 0.056 * 1e6) / 1e6,
    pricePerExtraMonthlyDollars: 1.68,
    pricePerExtraDailyDollars: 0.056,
  };
}

/**
 * Freeze a sandbox's disk under a name. Re-saving a name replaces that
 * snapshot's artifact; the old one is released first so storage does not grow.
 */
export async function saveNamedSnapshot(sandboxId: string, name: string) {
  if (!SAVED_NAME.test(name)) {
    throw new ServiceError(
      "invalid_body",
      `invalid name ${name}: 1-63 lowercase letters, digits or dashes, starting with a letter or digit`,
    );
  }

  if (RESERVED_NAMES.has(name)) {
    throw new ServiceError("invalid_body", `name ${name} is reserved`);
  }

  // Names are unique server-wide, so a name taken by another account must be
  // refused rather than silently taken over by the upsert below.
  const owner = await store.savedSnapshotOwner(name);

  if (owner !== undefined && owner !== currentOwnerId()) {
    throw new ServiceError("destination_exists", `name ${name} is already used by another account`);
  }

  const sandbox = await requireSandbox(sandboxId);
  driverFor(sandbox.runtimeId);
  const existing = await store.getSavedSnapshot(name);

  // A replace has to release the previous artifact.

  if (existing?.snapshotId) {
    const previous = await store.getSnapshot(existing.snapshotId);

    if (previous?.driverRef) {
      await driverFor(previous.runtimeId)
        .destroySnapshot(previous.driverRef)
        .catch(() => {});
    }

    await store.removeSnapshot(existing.snapshotId);
  }

  try {
    const snapshot = await snapshotSandbox(sandboxId, name);
    await store.upsertSavedSnapshot({
      name,
      status: "ready",
      sourceSandboxId: sandboxId,
      snapshotId: snapshot.id,
      type: sandbox.type,
      sizeBytes: snapshot.sizeBytes ?? null,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.upsertSavedSnapshot({
      name,
      status: "failed",
      error: message,
      sourceSandboxId: sandboxId,
      createdAt: new Date().toISOString(),
    });
  }
  return savedSnapshot((await store.getSavedSnapshot(name))!);
}

export async function requireSavedSnapshot(name: string) {
  const row = await store.getSavedSnapshot(name);

  if (!row) throw new ServiceError("not_found", `no saved snapshot ${name}`);

  return row;
}

export async function deleteSavedSnapshot(name: string) {
  const row = await requireSavedSnapshot(name);

  if (row.status === "saving") {
    throw new ServiceError("sandbox_not_ready", `save_in_progress: ${name} is still saving`);
  }

  if (row.snapshotId) {
    const snapshot = await store.getSnapshot(row.snapshotId);

    if (snapshot?.driverRef) {
      await driverFor(snapshot.runtimeId)
        .destroySnapshot(snapshot.driverRef)
        .catch(() => {});
    }

    await store.removeSnapshot(row.snapshotId);
  }

  await store.deleteSharesOf(name);
  await store.deleteSavedSnapshot(name);
  return { name, status: "deleted" as const };
}

export function shapeShare(row: SnapshotShareRow) {
  return {
    id: row.id,
    codePrefix: row.codePrefix,
    status: row.revokedAt ? ("revoked" as const) : ("active" as const),
    useCount: row.useCount,
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSnapshotShares(name: string) {
  await requireSavedSnapshot(name);
  return (await store.listShares(name)).map(shapeShare);
}

/** A share code is shown once; only its hash is kept. */
export async function createSnapshotShare(name: string) {
  await requireSavedSnapshot(name);

  const shareId = newId("shr");
  const code = `bsh_${Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex")}`;
  await store.insertShare({
    id: shareId,
    name,
    codeHash: createHash("sha256").update(code).digest("hex"),
    codePrefix: code.slice(0, 12),
    createdAt: new Date().toISOString(),
  });

  return { name, shareCode: code, share: shapeShare((await store.getShare(shareId))!) };
}

export async function revokeSnapshotShare(name: string, shareId: string) {
  await requireSavedSnapshot(name);
  const share = await store.getShare(shareId);

  if (!share || share.name !== name) {
    throw new ServiceError("not_found", "no such share");
  }

  await store.revokeShare(share.id, new Date().toISOString());
  return shapeShare((await store.getShare(share.id))!);
}
