import { createHash } from "node:crypto";
import {
  LOCAL_RUNTIME_ID,
  RUNTIME_NAME,
  runtimeToken,
  type AgentHello,
  type CreateRuntimeRequest,
  type Runtime,
  type RuntimeSample,
  type UpdateRuntimeRequest,
} from "@spaces/shared/runtime";
import { config } from "../../config.ts";
import { iso, now, store, type RuntimeRow, type RuntimeSampleRow } from "../../db.ts";
import { RuntimeUnavailable, ServiceError } from "../../errors.ts";
import { driverFor, localDriver } from "../driver/service.ts";
import { detectResources } from "../driver/resources.ts";
import { isLocalHost } from "../driver/ssh.ts";
import type { MachineSpec, SandboxDriver } from "../driver/types.ts";
import { closeConnection, connectionOf } from "./connections.ts";
import { capacityOf, noRoomMessage, roomFor } from "./placement.ts";
import type { CreatedRuntime, Room, RuntimeLoad, SchedulingRequest } from "./types.ts";

const EMPTY_LOAD: RuntimeLoad = { active: 0, total: 0, snapshots: 0, vcpu: 0, memMib: 0 };

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

let localReady: Promise<void> | null = null;

export function ensureLocalRuntime(): Promise<void> {
  localReady ??= syncLocalRuntime().catch((error: unknown) => {
    localReady = null;
    throw error;
  });

  return localReady;
}

async function syncLocalRuntime(): Promise<void> {
  const existing = await store.getRuntime(LOCAL_RUNTIME_ID);

  if (!config.runtime.local) {
    if (existing) await store.updateRuntime(LOCAL_RUNTIME_ID, { state: "offline" });

    return;
  }

  const driver = localDriver();
  const portsOn = config.portRange.start > 0 && config.portRange.end >= config.portRange.start;
  const resources = detectResources(driver.kind, isLocalHost(config.msbHost));
  const facts = {
    driverKind: driver.kind,
    capabilities: driver.capabilities,
    vcpu: resources?.vcpu ?? null,
    memMib: resources?.memMib ?? null,
    portStart: portsOn ? config.portRange.start : null,
    portEnd: portsOn ? config.portRange.end : null,
    portBind: config.portBind,
  };

  if (!existing) {
    await store.insertRuntime({
      id: LOCAL_RUNTIME_ID,
      name: LOCAL_RUNTIME_ID,
      kind: "local",
      state: "online",
      ...facts,
    });
    return;
  }

  await store.updateRuntime(LOCAL_RUNTIME_ID, { state: "online", ...facts });
}

export async function resetRuntimeStates(): Promise<void> {
  await store.markRuntimesOffline([]);
}

export function shapeRuntime(row: RuntimeRow, load: RuntimeLoad = EMPTY_LOAD): Runtime {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as Runtime["kind"],
    state: row.state as Runtime["state"],
    draining: row.draining,
    labels: row.labels,
    maxSandboxes: row.maxSandboxes,
    activeSandboxes: load.active,
    totalSandboxes: load.total,
    snapshots: load.snapshots,
    resources: row.vcpu && row.memMib ? { vcpu: row.vcpu, memMib: row.memMib } : null,
    committed: { vcpu: load.vcpu, memMib: load.memMib },
    overcommit: config.runtime.overcommit,
    driver: row.driverKind,
    capabilities: row.capabilities,
    publicHost: row.publicHost,
    agentVersion: row.agentVersion,
    protocol: row.protocol,
    tokenPrefix: row.tokenPrefix,
    connectedAt: iso(row.connectedAt),
    lastSeenAt: iso(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listRuntimes(): Promise<Runtime[]> {
  await ensureLocalRuntime();
  const [rows, load] = await Promise.all([store.listRuntimes(), store.runtimeLoad()]);

  return rows.map((row) => shapeRuntime(row, load.get(row.id)));
}

export async function findRuntime(reference: string): Promise<RuntimeRow | null> {
  await ensureLocalRuntime();

  return (await store.getRuntime(reference)) ?? (await store.runtimeByName(reference));
}

export async function requireRuntime(reference: string): Promise<RuntimeRow> {
  const row = await findRuntime(reference);

  if (!row) throw new ServiceError("not_found", `no runtime ${reference}`);

  return row;
}

export async function getRuntime(reference: string): Promise<Runtime> {
  const row = await requireRuntime(reference);
  const load = await store.runtimeLoad();

  return shapeRuntime(row, load.get(row.id));
}

export async function createRuntime(input: CreateRuntimeRequest): Promise<CreatedRuntime> {
  await ensureLocalRuntime();

  if (!RUNTIME_NAME.test(input.name) || (await store.runtimeByName(input.name))) {
    throw new ServiceError("destination_exists", `a runtime named ${input.name} already exists`);
  }

  const id = `rt_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const token = runtimeToken();
  await store.insertRuntime({
    id,
    name: input.name,
    kind: "agent",
    labels: input.labels,
    maxSandboxes: input.maxSandboxes,
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, 12),
  });

  return { runtime: (await store.getRuntime(id))!, token };
}

export async function updateRuntime(
  reference: string,
  patch: UpdateRuntimeRequest,
): Promise<Runtime> {
  const row = await requireRuntime(reference);

  const changes: Parameters<typeof store.updateRuntime>[1] = {};

  if (patch.name !== undefined && patch.name !== row.name) {
    if (await store.runtimeByName(patch.name)) {
      throw new ServiceError("destination_exists", `a runtime named ${patch.name} already exists`);
    }

    changes.name = patch.name;
  }

  if (patch.labels !== undefined) changes.labels = patch.labels;

  if (patch.maxSandboxes !== undefined) changes.maxSandboxes = patch.maxSandboxes;

  if (patch.draining !== undefined) changes.draining = patch.draining;

  await store.updateRuntime(row.id, changes);

  return getRuntime(row.id);
}

export async function rotateRuntimeToken(reference: string): Promise<CreatedRuntime> {
  const row = await requireRuntime(reference);

  if (row.kind !== "agent") {
    throw new ServiceError("invalid_body", "the built-in runtime has no token to rotate");
  }

  const token = runtimeToken();
  await store.updateRuntime(row.id, {
    tokenHash: hashToken(token),
    tokenPrefix: token.slice(0, 12),
  });
  closeConnection(row.id, "token rotated");

  return { runtime: (await store.getRuntime(row.id))!, token };
}

export async function deleteRuntime(reference: string): Promise<{ id: string; name: string }> {
  const row = await requireRuntime(reference);

  if (row.kind !== "agent") {
    throw new ServiceError("forbidden", "the built-in runtime cannot be deleted");
  }

  const load = (await store.runtimeLoad()).get(row.id) ?? EMPTY_LOAD;

  if (load.total > 0 || load.snapshots > 0) {
    throw new ServiceError(
      "destination_exists",
      `runtime ${row.name} still holds ${load.total} sandbox(es) and ${load.snapshots} snapshot(s); their disks live on it`,
    );
  }

  closeConnection(row.id, "runtime deleted");
  await store.deleteRuntime(row.id);

  return { id: row.id, name: row.name };
}

export async function authenticateAgent(token: string): Promise<RuntimeRow | null> {
  if (!token) return null;

  const row = await store.runtimeByTokenHash(hashToken(token));

  return row && row.kind === "agent" ? row : null;
}

export async function markRuntimeOnline(id: string, hello: AgentHello): Promise<void> {
  await store.updateRuntime(id, {
    state: "online",
    driverKind: hello.driver,
    capabilities: hello.capabilities,
    vcpu: hello.resources?.vcpu ?? null,
    memMib: hello.resources?.memMib ?? null,
    portStart: hello.portRange?.start ?? null,
    portEnd: hello.portRange?.end ?? null,
    portBind: hello.portBind,
    publicHost: hello.publicHost,
    agentVersion: hello.agentVersion,
    protocol: hello.protocol,
    connectedAt: now(),
    lastSeenAt: now(),
  });
}

export async function markRuntimeOffline(id: string): Promise<void> {
  await store.updateRuntime(id, { state: "offline" });
}

export async function touchRuntime(id: string): Promise<void> {
  await store.updateRuntime(id, { state: "online", lastSeenAt: now() });
}

export function isRuntimeReachable(runtimeId: string): boolean {
  if (runtimeId === LOCAL_RUNTIME_ID) return config.runtime.local;

  const connection = connectionOf(runtimeId);

  return connection !== null && !connection.closed;
}

export async function driverOfSandbox(sandboxId: string): Promise<SandboxDriver> {
  const runtimeId = await store.runtimeIdOf(sandboxId);

  if (!runtimeId) throw new ServiceError("not_found", `no sandbox ${sandboxId}`);

  return driverFor(runtimeId);
}

function roomOf(row: RuntimeRow, load: RuntimeLoad, size: MachineSpec | undefined): Room | null {
  if (!size) return null;

  const capacity = capacityOf(row, config.runtime.overcommit);

  return capacity ? roomFor(capacity, load, size) : null;
}

function refusal(row: RuntimeRow, load: RuntimeLoad, size?: MachineSpec): Error | null {
  if (row.state !== "online") return new RuntimeUnavailable(`runtime ${row.name} is offline`);

  if (row.draining) {
    return new ServiceError(
      "forbidden",
      `runtime ${row.name} is draining and takes no new sandboxes`,
    );
  }

  if (row.maxSandboxes !== null && load.active >= row.maxSandboxes) {
    return new ServiceError(
      "forbidden",
      `runtime ${row.name} is at its limit of ${row.maxSandboxes} sandboxes`,
    );
  }

  const room = roomOf(row, load, size);

  if (room && size && !room.fits) {
    return new ServiceError("forbidden", noRoomMessage(row.name, size, room));
  }

  return null;
}

export async function assertRoom(runtimeId: string, size: MachineSpec): Promise<void> {
  const row = await store.getRuntime(runtimeId);

  if (!row) return;

  const load = (await store.runtimeLoad()).get(runtimeId) ?? EMPTY_LOAD;
  const room = roomOf(row, load, size);

  if (room && !room.fits) throw new ServiceError("forbidden", noRoomMessage(row.name, size, room));
}

function ranked(rows: RuntimeRow[], load: (row: RuntimeRow) => RuntimeLoad, size?: MachineSpec) {
  const keyed = rows.map((row) => ({
    row,
    utilization: roomOf(row, load(row), size)?.utilization ?? null,
    active: load(row).active,
  }));

  return keyed
    .sort((a, b) => {
      if ((a.utilization === null) !== (b.utilization === null)) {
        return a.utilization === null ? 1 : -1;
      }

      const byUse = (a.utilization ?? 0) - (b.utilization ?? 0);

      return byUse || a.active - b.active || a.row.name.localeCompare(b.row.name);
    })
    .map((entry) => entry.row);
}

export async function pickRuntime(request: SchedulingRequest = {}): Promise<RuntimeRow> {
  await ensureLocalRuntime();
  const rows = await store.listRuntimes();
  const load = await store.runtimeLoad();
  const loadOf = (row: RuntimeRow) => load.get(row.id) ?? EMPTY_LOAD;
  const named = request.pin
    ? (rows.find((row) => row.id === request.pin || row.name === request.pin) ?? null)
    : null;

  if (request.pin && !named) throw new ServiceError("not_found", `no runtime ${request.pin}`);

  const source = request.sourceRuntimeId
    ? (rows.find((row) => row.id === request.sourceRuntimeId) ?? null)
    : null;

  if (request.sourceRuntimeId && !source) {
    throw new RuntimeUnavailable(
      `the runtime holding that disk (${request.sourceRuntimeId}) is gone`,
    );
  }

  if (source && named && source.id !== named.id) {
    throw new ServiceError(
      "invalid_body",
      `that disk lives on runtime ${source.name}; it cannot start on ${named.name}`,
    );
  }

  const target = source ?? named;

  if (target) {
    const refused = refusal(target, loadOf(target), request.size);

    if (refused) throw refused;

    return target;
  }

  const open = ranked(
    rows.filter((row) => refusal(row, loadOf(row), request.size) === null),
    loadOf,
    request.size,
  );

  if (open[0]) return open[0];

  const reasons = rows.map(
    (row) => `${row.name}: ${refusal(row, loadOf(row), request.size)?.message ?? "open"}`,
  );
  throw new RuntimeUnavailable(
    rows.length === 0
      ? "no runtime is registered"
      : `no runtime can take a new sandbox (${reasons.join("; ")})`,
  );
}

export async function sampleCluster(): Promise<number> {
  await ensureLocalRuntime();
  const [rows, load] = await Promise.all([store.listRuntimes(), store.runtimeLoad()]);
  const at = new Date();
  const samples: RuntimeSampleRow[] = [];

  for (const row of rows) {
    if (row.state !== "online") continue;

    const entry = load.get(row.id) ?? EMPTY_LOAD;

    samples.push({
      runtimeId: row.id,
      at,
      activeSandboxes: entry.active,
      vcpuCommitted: entry.vcpu,
      memMibCommitted: entry.memMib,
      vcpuCapacity: row.vcpu,
      memMibCapacity: row.memMib,
    });
  }

  await store.insertRuntimeSamples(samples);

  return samples.length;
}

export async function clusterSamples(
  minutes: number,
  runtimeId?: string,
): Promise<RuntimeSample[]> {
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await store.runtimeSamplesSince(since, runtimeId);

  return rows.map((row) => ({
    runtimeId: row.runtimeId,
    at: row.at.toISOString(),
    activeSandboxes: row.activeSandboxes,
    vcpuCommitted: row.vcpuCommitted,
    memMibCommitted: row.memMibCommitted,
    vcpuCapacity: row.vcpuCapacity,
    memMibCapacity: row.memMibCapacity,
  }));
}
