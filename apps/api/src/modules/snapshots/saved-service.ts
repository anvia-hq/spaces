import { store } from "../../db.ts";
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

  const owner = await store.savedSnapshotOwner(name);

  if (owner !== undefined && owner !== currentOwnerId()) {
    throw new ServiceError("destination_exists", `name ${name} is already used by another account`);
  }

  const sandbox = await requireSandbox(sandboxId);
  driverFor(sandbox.runtimeId);
  const existing = await store.getSavedSnapshot(name);

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

  await store.deleteSavedSnapshot(name);
  return { name, status: "deleted" as const };
}
