import { store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import type { CreateSource } from "./types.ts";

export async function resolveCreateSource(from: string): Promise<CreateSource> {
  const sandbox = await store.raw(from);

  if (sandbox?.driverRef) {
    return {
      kind: "sandbox",
      id: sandbox.id,
      driverRef: sandbox.driverRef,
      runtimeId: sandbox.runtimeId,
    };
  }

  if (from.startsWith("bsh_")) {
    throw new ServiceError(
      "not_found",
      "snapshot_not_found: share codes cannot be used as a create source",
    );
  }

  const saved = await store.getSavedSnapshot(from);

  if (!saved) {
    throw new ServiceError(
      "not_found",
      `snapshot_not_found: no sandbox or saved snapshot named ${from}`,
    );
  }

  if (saved.status !== "ready") {
    const reason = saved.error ? `: ${saved.error}` : "";
    throw new ServiceError(
      "sandbox_not_ready",
      `snapshot_not_ready: saved snapshot ${from} is ${saved.status}${reason}`,
    );
  }

  if (!saved.snapshotId) {
    throw new ServiceError(
      "not_found",
      `snapshot_not_found: saved snapshot ${from} has no stored artifact`,
    );
  }

  const artifact = await store.getSnapshot(saved.snapshotId);

  if (!artifact) {
    throw new ServiceError(
      "not_found",
      `snapshot_not_found: saved snapshot ${from} points at a missing artifact`,
    );
  }

  if (artifact.state !== "ready") {
    throw new ServiceError(
      "sandbox_not_ready",
      `snapshot_not_ready: saved snapshot ${from} has an artifact that is ${artifact.state}`,
    );
  }

  if (!artifact.driverRef) {
    throw new ServiceError(
      "not_found",
      `snapshot_not_found: saved snapshot ${from} has no stored artifact`,
    );
  }

  return {
    kind: "snapshot",
    name: saved.name,
    driverRef: artifact.driverRef,
    runtimeId: artifact.runtimeId,
  };
}
