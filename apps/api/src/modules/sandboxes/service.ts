import { newId, newSandboxId } from "@spaces/shared/errors";
import type {
  CreateFileRequest,
  CreateHostedPortRequest,
  CreateSandboxRequest,
  NetworkPolicy,
  Sandbox,
  SandboxState,
  SandboxType,
} from "@spaces/shared/sandbox";
import { config } from "../../config.ts";
import { iso, now, store, type RuntimeRow } from "../../db.ts";
import { withSpan } from "../traces/tracer.ts";
import { ServiceError } from "../../errors.ts";
import { driverFor } from "../driver/service.ts";
import type { DriverHandle, MachineSpec, SandboxDriver } from "../driver/types.ts";
import { requireActiveMachineSize } from "../machine-sizes/service.ts";
import { assertRoom, pickRuntime } from "../runtimes/service.ts";
import type { SchedulingRequest } from "../runtimes/types.ts";
import { resolveCreateSource } from "./create-source.ts";
import { portRangeOf, reservePrepublishPorts, republishPorts } from "./host-ports.ts";
import type { CreateSource } from "./types.ts";

function ttlToArchiveAfter(ttlSeconds: number | null): string | null {
  if (ttlSeconds === null) return null;

  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export async function findIdempotentSandbox(key: string): Promise<Sandbox | null> {
  const existing = await store.getIdempotencyKey(key);

  if (!existing) return null;

  return await store.get(existing);
}

export async function rememberIdempotentSandbox(key: string, sandboxId: string): Promise<void> {
  await store.putIdempotencyKey(key, sandboxId, new Date(Date.now() + IDEMPOTENCY_TTL_MS));
}

export function parseSandboxCursor(raw: string): { at: Date; id: string } | null {
  const split = raw.indexOf("|");

  if (split <= 0 || split === raw.length - 1) return null;

  const at = new Date(raw.slice(0, split));

  if (Number.isNaN(at.getTime())) return null;

  return { at, id: raw.slice(split + 1) };
}

export async function createSandbox(
  input: CreateSandboxRequest,
): Promise<{ sandbox: Sandbox; ready: boolean }> {
  if ((await store.totalSandboxes()) >= config.limits.maxSandboxes) {
    throw new ServiceError(
      "forbidden",
      `sandbox limit reached (${config.limits.maxSandboxes}); delete one first`,
    );
  }

  const size = await requireActiveMachineSize(input.type);

  const source = input.from ? await resolveCreateSource(input.from) : null;
  const scheduling: SchedulingRequest = { size };

  if (input.runtime) scheduling.pin = input.runtime;

  if (source) scheduling.sourceRuntimeId = source.runtimeId;

  const runtime = await pickRuntime(scheduling);

  if (input.hostedPorts?.length && !portRangeOf(runtime)) {
    throw new ServiceError(
      "provider_not_configured",
      runtime.kind === "local"
        ? "Port publishing is disabled on this server (SPACES_PORT_RANGE_START=0)."
        : `Port publishing is disabled on runtime ${runtime.name} (no port range advertised).`,
    );
  }

  const id = newSandboxId();
  const name = input.name ?? `Spaces ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  await store.insert({
    id,
    name,
    state: "provisioning",
    type: input.type,
    labels: input.labels,
    env: input.env,
    ttlSeconds: input.ttlSeconds,
    archiveAfter: ttlToArchiveAfter(input.ttlSeconds),
    runtimeId: runtime.id,
    setupStatus: input.setupScript !== undefined ? "pending" : null,
    networkPolicy: input.network ?? null,
  });
  await store.event(id, "sandbox.created", { type: input.type, runtime: runtime.name });

  const provisioning = provision({
    id,
    runtime,
    type: input.type,
    size,
    env: input.env,
    source,
    setupScript: input.setupScript,
    hostedPorts: input.hostedPorts,
    files: input.files,
    network: input.network,
  });

  if (!input.wait) {
    void provisioning.catch(() => {});
    return { sandbox: (await store.get(id))!, ready: false };
  }

  const settled = await Promise.race([
    provisioning.then(() => true),
    Bun.sleep(input.waitTimeoutSeconds * 1000).then(() => false),
  ]);

  const sandbox = (await store.get(id))!;

  if (sandbox.state === "error") {
    throw new ServiceError("internal", sandbox.error ?? "sandbox provisioning failed");
  }

  return {
    sandbox,
    ready: settled && ["ready", "running", "idle"].includes(sandbox.state),
  };
}

interface ProvisionOptions {
  id: string;
  runtime: RuntimeRow;
  type: SandboxType;
  size: MachineSpec;
  env: Record<string, string>;
  source: CreateSource | null;
  setupScript?: string;
  hostedPorts?: CreateHostedPortRequest[];
  files?: CreateFileRequest[];
  network?: NetworkPolicy;
}

async function provision(options: ProvisionOptions) {
  return withSpan(
    "sandbox.provision",
    { "spaces.sandbox_id": options.id, "spaces.type": options.type },
    () => provisionInner(options),
  );
}

async function writeCreateFiles(
  driver: SandboxDriver,
  ref: string,
  files: CreateFileRequest[],
): Promise<void> {
  const encoder = new TextEncoder();

  for (const file of files) {
    const bytes =
      file.encoding === "base64"
        ? new Uint8Array(Buffer.from(file.content, "base64"))
        : encoder.encode(file.content);
    await driver.writeFile(ref, file.path, bytes);
  }
}

async function provisionInner(options: ProvisionOptions) {
  const { id, runtime, type, size, env, source, setupScript, hostedPorts, files, network } =
    options;
  const started = Date.now();

  try {
    const ports = await reservePrepublishPorts(id, runtime, hostedPorts);
    const driver = driverFor(runtime.id);
    const driverOptions = { sandboxId: id, type, size, env, ports, network };
    let handle: DriverHandle;

    if (!source) {
      handle = await driver.create(driverOptions);
    } else if (source.kind === "snapshot") {
      handle = await driver.restore({ ...driverOptions, fromRef: source.driverRef });
    } else {
      handle = await driver.fork({ ...driverOptions, fromRef: source.driverRef });
    }

    await republishPorts(id, driver);
    await runBootstrap(id, driver, handle.ref);

    if (files && files.length > 0) {
      await writeCreateFiles(driver, handle.ref, files);
    }

    await store.update(id, {
      state: "ready",
      url: handle.url,
      ip: handle.ip,
      driverRef: handle.ref,
      error: null,
      hydrated: true,
      hydratedAt: now(),
    });
    await store.event(id, "sandbox.ready", { ms: Date.now() - started, ref: handle.ref });

    if (setupScript !== undefined) void runSetupScript(id, driver, handle.ref, setupScript);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.deletePortsOf(id);
    await store.update(id, { state: "error", error: message });
    await store.event(id, "sandbox.error", { message });
  }
}

export async function requireSandbox(id: string): Promise<Sandbox> {
  const sandbox = await store.get(id);

  if (!sandbox) throw new ServiceError("not_found", `no sandbox ${id}`);

  return sandbox;
}

export const LIVE_STATES: Sandbox["state"][] = ["ready", "idle", "running", "provisioning"];

export async function requireLiveSandbox(id: string) {
  const sandbox = await requireSandbox(id);

  if (!["ready", "running", "idle"].includes(sandbox.state)) {
    throw new ServiceError("sandbox_not_ready", `sandbox is ${sandbox.state}; resume it first`);
  }

  const row = (await store.raw(id))!;

  return {
    sandbox,
    ref: row.driverRef ?? `msb:${id}`,
    driver: driverFor(row.runtimeId),
  };
}

export async function getSandbox(id: string): Promise<Sandbox> {
  return await requireSandbox(id);
}

export async function getSandboxNetwork(id: string): Promise<NetworkPolicy> {
  const sandbox = await requireSandbox(id);
  return sandbox.network ?? { mode: "default", allow: [] };
}

export async function listSandboxes(filter: Parameters<typeof store.list>[0]) {
  return await store.list(filter);
}

export async function listSandboxesPage(filter: Parameters<typeof store.listPage>[0]) {
  return await store.listPage(filter);
}

export async function sandboxEvents(id: string, after: number) {
  const rows = await store.listEvents(id, after);

  return rows.map((e) => ({
    ...e.payload,
    id: e.id,
    type: e.type,
    at: e.at.toISOString(),
  }));
}

export async function updateSandbox(
  id: string,
  patch: { name?: string; labels?: Record<string, string> | null; ttlSeconds?: number | null },
): Promise<Sandbox> {
  await requireSandbox(id);

  const changes: {
    name?: string;
    labels?: Record<string, string>;
    archiveAfter?: string | null;
  } = {};

  if (patch.name !== undefined) changes.name = patch.name;

  if (patch.labels !== undefined) changes.labels = patch.labels ?? {};

  if (patch.ttlSeconds !== undefined) changes.archiveAfter = ttlToArchiveAfter(patch.ttlSeconds);

  await store.update(id, changes);

  return (await store.get(id))!;
}

export function stopOperation(row: {
  id: string;
  status: string;
  requestedAt: Date | null;
  lastAttemptAt: Date | null;
  error: string | null;
  endedAt: Date | null;
  forced: boolean;
}) {
  return {
    id: row.id,
    status: row.status as "pending" | "failing" | "completed" | "superseded",
    requestedAt: iso(row.requestedAt),
    lastAttemptAt: iso(row.lastAttemptAt),
    error: row.error,
    endedAt: iso(row.endedAt),
    forced: row.forced,
  };
}

export async function getStopOperation(id: string, stopId: string) {
  await requireSandbox(id);
  const row = await store.getStop(stopId);

  if (!row || row.sandboxId !== id) {
    throw new ServiceError("not_found", `no stop ${stopId} for sandbox ${id}`);
  }

  return stopOperation(row);
}

export async function stopSandbox(
  id: string,
  options: { force?: boolean } = {},
): Promise<{ stopId: string; stop: ReturnType<typeof stopOperation>; sandbox: Sandbox }> {
  return withSpan("sandbox.stop", { "spaces.sandbox_id": id }, () => stopInner(id, options));
}

async function stopInner(
  id: string,
  options: { force?: boolean } = {},
): Promise<{ stopId: string; stop: ReturnType<typeof stopOperation>; sandbox: Sandbox }> {
  const sandbox = await requireSandbox(id);

  if (sandbox.state === "archived") {
    const existing = await store.pendingStop(id);
    const last = existing ?? (await store.getStop((await store.lastStopId(id)) ?? ""));
    return {
      stopId: last?.id ?? newId("stop"),
      stop: last
        ? stopOperation(last)
        : {
            id: newId("stop"),
            status: "completed" as const,
            requestedAt: null,
            lastAttemptAt: null,
            error: null,
            endedAt: sandbox.stoppedAt ?? null,
            forced: false,
          },
      sandbox,
    };
  }

  if (sandbox.state === "archiving") {
    const pending = await store.pendingStop(id);

    if (pending) {
      return { stopId: pending.id, stop: stopOperation(pending), sandbox };
    }
  }

  if (!LIVE_STATES.includes(sandbox.state)) {
    throw new ServiceError("sandbox_not_ready", `sandbox is ${sandbox.state}, not running`);
  }

  const driver = driverFor(sandbox.runtimeId);

  let stopRow = await store.pendingStop(id);

  if (!stopRow) {
    const stopId = newId("stop");
    await store.insertStop({
      id: stopId,
      sandboxId: id,
      status: "pending",
      requestedAt: now(),
      forced: options.force ?? false,
    });
    stopRow = (await store.getStop(stopId))!;
  } else if (options.force && !stopRow.forced) {
    await store.updateStop(stopRow.id, { forced: true });
  }

  await store.update(id, { state: "archiving" });
  await store.event(id, "sandbox.stopping");

  try {
    const { diskRef } = await driver.stop(id);
    await store.update(id, {
      state: "archived",
      stoppedAt: now(),
      snapshotAt: now(),
      driverRef: diskRef,
      url: null,
      ip: null,
    });
    await store.updateStop(stopRow.id, {
      status: "completed",
      lastAttemptAt: now(),
      endedAt: now(),
      error: null,
    });
    await store.event(id, "sandbox.stopped", { diskRef });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(id, { state: "error", error: message });
    await store.updateStop(stopRow.id, {
      status: "failing",
      lastAttemptAt: now(),
      error: message,
    });
    await store.event(id, "sandbox.stop_failed", { message });
    throw new ServiceError("internal", message);
  }

  return {
    stopId: stopRow.id,
    stop: stopOperation((await store.getStop(stopRow.id))!),
    sandbox: (await store.get(id))!,
  };
}

export async function resumeSandbox(
  id: string,
  options: {
    ttlSeconds?: number | null;
    type?: SandboxType;
    name?: string;
    env?: Record<string, string>;
  } = {},
): Promise<Sandbox> {
  return withSpan("sandbox.resume", { "spaces.sandbox_id": id }, () => resumeInner(id, options));
}

async function resumeInner(
  id: string,
  options: {
    ttlSeconds?: number | null;
    type?: SandboxType;
    name?: string;
    env?: Record<string, string>;
  } = {},
): Promise<Sandbox> {
  const sandbox = await requireSandbox(id);

  if (sandbox.state !== "archived") {
    throw new ServiceError("sandbox_not_ready", `sandbox is ${sandbox.state}, not stopped`);
  }

  const row = (await store.raw(id))!;

  if (!row.driverRef) {
    throw new ServiceError("sandbox_not_ready", "sandbox has no persisted disk");
  }

  const type = options.type ?? sandbox.type;
  const size = await requireActiveMachineSize(type);
  const driver = driverFor(sandbox.runtimeId);
  await assertRoom(sandbox.runtimeId, size);
  const pending = await store.pendingStop(id);

  if (pending) {
    await store.updateStop(pending.id, { status: "superseded", endedAt: now() });
  }

  const resume: {
    state: SandboxState;
    type: SandboxType;
    name?: string;
    env?: Record<string, string>;
    ttlSeconds?: number | null;
    archiveAfter?: string | null;
  } = { state: "provisioning", type };

  if (options.name !== undefined) resume.name = options.name;

  if (options.env !== undefined) resume.env = options.env;

  if (options.ttlSeconds !== undefined) {
    resume.ttlSeconds = options.ttlSeconds;
    resume.archiveAfter = ttlToArchiveAfter(options.ttlSeconds);
  }

  await store.update(id, resume);

  const resuming: { ttlSeconds?: number | null } = {};

  if (options.ttlSeconds !== undefined) resuming.ttlSeconds = options.ttlSeconds;

  await store.event(id, "sandbox.resuming", resuming);

  const env = options.env ?? (await store.env(id));

  try {
    const handle = await driver.resume({
      sandboxId: id,
      type,
      size,
      fromRef: row.driverRef,
      env,
    });
    await republishPorts(id, driver);
    await runBootstrap(id, driver, handle.ref);
    await store.update(id, {
      state: "ready",
      url: handle.url,
      ip: handle.ip,
      driverRef: handle.ref,
      stoppedAt: null,
      error: null,
    });
    await store.event(id, "sandbox.resumed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(id, { state: "error", error: message });
    throw new ServiceError("internal", message);
  }

  return (await store.get(id))!;
}

export async function forkSandbox(
  id: string,
  overrides: Partial<CreateSandboxRequest> = {},
): Promise<Sandbox> {
  return withSpan("sandbox.fork", { "spaces.sandbox_id": id }, () => forkInner(id, overrides));
}

function sameNetworkPolicy(a: NetworkPolicy | null | undefined, b: NetworkPolicy): boolean {
  const effectiveA: NetworkPolicy = a ?? { mode: "default", allow: [] };
  return (
    effectiveA.mode === b.mode &&
    effectiveA.allow.length === b.allow.length &&
    effectiveA.allow.every((entry, idx) => entry === b.allow[idx])
  );
}

async function forkInner(
  id: string,
  overrides: Partial<CreateSandboxRequest> = {},
): Promise<Sandbox> {
  const source = await requireSandbox(id);
  const row = (await store.raw(id))!;

  if (!row.driverRef) {
    throw new ServiceError("sandbox_not_ready", "source has no disk to fork");
  }

  if (overrides.network && !sameNetworkPolicy(row.networkPolicy, overrides.network)) {
    throw new ServiceError(
      "network_policy_unsupported",
      "fork inherits the source sandbox's network policy; create from a saved snapshot to apply a different policy",
    );
  }

  const newId_ = newSandboxId();
  const type = overrides.type ?? source.type;
  const size = await requireActiveMachineSize(type);
  const runtime = await pickRuntime({ sourceRuntimeId: row.runtimeId, size });
  const env = overrides.env ?? (await store.env(id));
  await store.insert({
    id: newId_,
    name: overrides.name ?? `${source.name} (fork)`,
    state: "cloning",
    type,
    labels: overrides.labels ?? source.labels,
    env,
    ttlSeconds: overrides.ttlSeconds ?? 3600,
    archiveAfter: ttlToArchiveAfter(overrides.ttlSeconds ?? 3600),
    forkOf: id,
    runtimeId: runtime.id,
    networkPolicy: row.networkPolicy ?? null,
  });
  await store.event(newId_, "sandbox.fork", { from: id });
  await store.event(id, "sandbox.forked", { into: newId_ });

  void provision({
    id: newId_,
    runtime,
    type,
    size,
    env,
    source: {
      kind: "sandbox",
      id,
      driverRef: row.driverRef,
      runtimeId: row.runtimeId,
    },
  }).catch(() => {});

  return (await store.get(newId_))!;
}

async function runBootstrap(id: string, driver: SandboxDriver, ref: string): Promise<void> {
  const script = config.bootstrap.trim();

  if (!script || config.driver === "mock") return;

  const started = Date.now();
  try {
    const result = await driver.exec(ref, {
      command: script,
      timeoutSeconds: config.bootstrapTimeoutSeconds,
      runAs: "root",
    });
    const payload: { ms: number; exitCode: number | null; stderr?: string } = {
      ms: Date.now() - started,
      exitCode: result.exitCode,
    };

    if (result.exitCode !== 0) payload.stderr = result.stderr.slice(0, 2000);

    await store.event(id, "sandbox.bootstrap", payload);
  } catch (error) {
    await store.event(id, "sandbox.bootstrap_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function runSetupScript(
  id: string,
  driver: SandboxDriver,
  ref: string,
  script: string,
): Promise<void> {
  const started = Date.now();
  await store.update(id, { setupStatus: "running", setupError: null });

  try {
    const result = await driver.exec(ref, {
      command: script,
      timeoutSeconds: config.bootstrapTimeoutSeconds,
    });
    const payload: { ms: number; exitCode: number | null; stderr?: string } = {
      ms: Date.now() - started,
      exitCode: result.exitCode,
    };

    if (result.exitCode === 0 && !result.timedOut) {
      await store.update(id, { setupStatus: "done", setupError: null });
    } else {
      const detail = result.stderr.trim().slice(0, 2000);
      let summary = `exit ${result.exitCode ?? "unknown"}`;

      if (result.timedOut) {
        summary = `timed out after ${config.bootstrapTimeoutSeconds}s`;
      } else if (detail) {
        summary = `${summary}: ${detail}`;
      }

      if (detail) payload.stderr = detail;

      await store.update(id, { setupStatus: "failed", setupError: summary });
    }

    await store.event(id, "sandbox.setup_script", payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(id, { setupStatus: "failed", setupError: message.slice(0, 2000) });
    await store.event(id, "sandbox.setup_script_failed", { message });
  }
}

export async function destroySandbox(id: string): Promise<void> {
  return withSpan("sandbox.destroy", { "spaces.sandbox_id": id }, () => destroyInner(id));
}

async function destroyInner(id: string): Promise<void> {
  const sandbox = await requireSandbox(id);
  const driver = driverFor(sandbox.runtimeId);
  try {
    await driver.destroy(id);
  } catch {}
  await store.deletePortsOf(id);
  await store.event(id, "sandbox.deleted");
  await store.remove(id);
}

export async function recoverSandbox(id: string) {
  const sandbox = await requireSandbox(id);

  if (sandbox.state === "archived") {
    throw new ServiceError(
      "sandbox_not_ready",
      "no_machine: this sandbox has no machine. Resume it instead.",
    );
  }

  const driver = driverFor(sandbox.runtimeId);

  const reachable = await driver
    .exec(`msb:${id}`, { command: "true", timeoutSeconds: 5 })
    .then((r) => r.exitCode === 0)
    .catch(() => false);

  if (reachable) {
    throw new ServiceError(
      "sandbox_not_ready",
      "sandbox_is_reachable: the sandbox answers normally, nothing to recover.",
    );
  }

  const last = await store.get(id);

  if (last && Date.now() - Date.parse(last.updatedAt ?? last.createdAt) < 10 * 60 * 1000) {
    if ((await store.allEvents(id)).some((e) => e.type === "sandbox.recover")) {
      throw new ServiceError(
        "sandbox_not_ready",
        "too_soon: a recover started under 10 minutes ago.",
      );
    }
  }

  await store.event(id, "sandbox.recover");
  await store.update(id, { state: "provisioning" });
  try {
    await driver.restart(id);
    await store.update(id, { state: "ready", error: null });
    await store.event(id, "sandbox.recovered");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await store.update(id, { state: "error", error: message });
    await store.event(id, "sandbox.recover_failed", { message });
    throw new ServiceError("internal", `reset_failed: ${message}`);
  }

  return {
    type: "sandbox.recovering" as const,
    status: "recovering" as const,
    message: "Power-cycle started. The sandbox usually answers again within 1-2 minutes.",
  };
}
