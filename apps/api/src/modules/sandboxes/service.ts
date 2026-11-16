import { newId, newSandboxId } from "@spaces/shared/errors";
import type {
  CreateSandboxRequest,
  Sandbox,
  SandboxState,
  SandboxType,
} from "@spaces/shared/sandbox";
import { config } from "../../config.ts";
import { iso, now, store } from "../../db.ts";
import { withSpan } from "../traces/tracer.ts";
import { ServiceError } from "../../errors.ts";
import { driver } from "../driver/service.ts";
import { reservePrepublishPorts, republishPorts } from "./host-ports.ts";

function ttlToArchiveAfter(ttlSeconds: number | null): string | null {
  if (ttlSeconds === null) return null;

  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

/** Idempotency keys of the running process, mapped to the sandbox they created. */
const idempotent = new Map<string, string>();

export async function findIdempotentSandbox(key: string): Promise<Sandbox | null> {
  const existing = idempotent.get(key);

  if (!existing) return null;

  return await store.get(existing);
}

export function rememberIdempotentSandbox(key: string, sandboxId: string): void {
  idempotent.set(key, sandboxId);
}

/** Create a sandbox and return immediately in `provisioning`, like boat's 202. */
export async function createSandbox(input: CreateSandboxRequest): Promise<Sandbox> {
  if ((await store.totalSandboxes()) >= config.limits.maxSandboxes) {
    throw new ServiceError(
      "forbidden",
      `sandbox limit reached (${config.limits.maxSandboxes}); delete one first`,
    );
  }

  // `from` is honoured only when it names something with a disk. Boat answers
  // 404 snapshot_not_found for an unknown source; cold-booting a fresh sandbox
  // instead would look like success and quietly discard what was asked for.
  const source = input.from ? await resolveCreateSource(input.from) : null;

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
  });
  await store.event(id, "sandbox.created", { type: input.type });

  void provision(id, input.type, input.env, source?.id, input.setupScript).catch(() => {
    /* recorded on the row by provision() */
  });

  return (await store.get(id))!;
}

/**
 * Resolve a `from` selector to a sandbox whose disk can be forked.
 *
 * The spec also allows a saved-snapshot name or a `bsh_` share code. Restoring
 * from those needs a throwaway restore first (the same machinery snapshot
 * browsing uses) and is not wired into create yet, so they answer 404 with the
 * real reason rather than pretending.
 */
async function resolveCreateSource(from: string): Promise<Sandbox> {
  const source = await store.raw(from);

  if (source?.driverRef) return (await store.get(source.id))!;

  if (from.startsWith("bsh_") || (await store.getSavedSnapshot(from))) {
    throw new ServiceError(
      "not_found",
      "snapshot_not_found: creating from a saved snapshot is not supported yet; fork a sandbox or restore the snapshot first",
    );
  }

  throw new ServiceError("not_found", `snapshot_not_found: no sandbox or snapshot named ${from}`);
}

async function provision(
  id: string,
  type: SandboxType,
  env: Record<string, string>,
  from?: string,
  setupScript?: string,
) {
  return withSpan("sandbox.provision", { "spaces.sandbox_id": id, "spaces.type": type }, () =>
    provisionInner(id, type, env, from, setupScript),
  );
}

async function provisionInner(
  id: string,
  type: SandboxType,
  env: Record<string, string>,
  from?: string,
  setupScript?: string,
) {
  const started = Date.now();

  // Reserve host ports up front: the allocator reads the rows, so inserting
  // before create keeps two concurrent sandboxes off the same host port.
  const ports = await reservePrepublishPorts(id);

  try {
    const source = from ? await store.raw(from) : null;
    const handle =
      from && source?.driverRef
        ? await driver().fork({ sandboxId: id, type, fromRef: source.driverRef, env, ports })
        : await driver().create({ sandboxId: id, type, env, ports });

    await republishPorts(id, handle.ip ?? null);
    await runBootstrap(id, handle.ref);
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
    // boat's `setupScript`: starts once the sandbox is usable and never blocks
    // it becoming ready, so a slow script does not delay the 202.

    if (setupScript !== undefined) void runSetupScript(id, handle.ref, setupScript);
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

  return { sandbox, ref: (await store.raw(id))!.driverRef ?? `msb:${id}` };
}

export async function getSandbox(id: string): Promise<Sandbox> {
  return await requireSandbox(id);
}

export async function listSandboxes(filter: Parameters<typeof store.list>[0]) {
  return await store.list(filter);
}

export async function sandboxEvents(id: string, after: number) {
  const rows = await store.listEvents(id, after);

  return rows.map((e) => ({
    // Payload first: it may contain a `type` of its own (e.g. the machine
    // size on sandbox.created) and must not shadow the event discriminator.
    ...e.payload,
    id: e.id,
    type: e.type,
    at: e.at.toISOString(),
  }));
}

export async function updateSandbox(
  id: string,
  patch: { name?: string; labels?: Record<string, string>; ttlSeconds?: number | null },
): Promise<Sandbox> {
  await requireSandbox(id);

  const changes: {
    name?: string;
    labels?: Record<string, string>;
    archiveAfter?: string | null;
  } = {};

  if (patch.name !== undefined) changes.name = patch.name;

  if (patch.labels !== undefined) changes.labels = patch.labels;

  if (patch.ttlSeconds !== undefined) changes.archiveAfter = ttlToArchiveAfter(patch.ttlSeconds);

  await store.update(id, changes);

  return (await store.get(id))!;
}

/** boat's StopOperation shape. */
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
  // Unknown ids and ids of another sandbox are both 404.

  if (!row || row.sandboxId !== id) {
    throw new ServiceError("not_found", `no stop ${stopId} for sandbox ${id}`);
  }

  return stopOperation(row);
}

/**
 * Stop and archive. A stop is an operation: the row is created before any work
 * so a caller can always poll it, and a failed save leaves the sandbox running
 * with the stop marked `failing` rather than discarding the disk.
 */
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

  // Already archived: hand back the last stop, as boat does.

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

  // Reuse an in-flight stop so repeat calls return the same id.
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
    const { diskRef } = await driver().stop(id);
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
    // Keep the sandbox running: a refused stop must not discard the disk.
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
  options: { ttlSeconds?: number | null; type?: SandboxType; name?: string } = {},
): Promise<Sandbox> {
  return withSpan("sandbox.resume", { "spaces.sandbox_id": id }, () => resumeInner(id, options));
}

async function resumeInner(
  id: string,
  options: { ttlSeconds?: number | null; type?: SandboxType; name?: string } = {},
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
  // A resume ends any pending stop early, as `superseded`.
  const pending = await store.pendingStop(id);

  if (pending) {
    await store.updateStop(pending.id, { status: "superseded", endedAt: now() });
  }

  const resume: {
    state: SandboxState;
    type: SandboxType;
    name?: string;
    ttlSeconds?: number | null;
    archiveAfter?: string | null;
  } = { state: "provisioning", type };

  if (options.name !== undefined) resume.name = options.name;

  // The spec's resume request carries `ttlSeconds`: applying it resets the
  // auto-stop timer from now rather than from the original create.

  if (options.ttlSeconds !== undefined) {
    resume.ttlSeconds = options.ttlSeconds;
    resume.archiveAfter = ttlToArchiveAfter(options.ttlSeconds);
  }

  await store.update(id, resume);

  const resuming: { ttlSeconds?: number | null } = {};

  if (options.ttlSeconds !== undefined) resuming.ttlSeconds = options.ttlSeconds;

  await store.event(id, "sandbox.resuming", resuming);

  try {
    const handle = await driver().resume({
      sandboxId: id,
      type,
      fromRef: row.driverRef,
      env: await store.env(id),
    });
    await republishPorts(id, handle.ip ?? null);
    await runBootstrap(id, handle.ref);
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

/** Fork clones the source's disk into a brand new sandbox. */
export async function forkSandbox(
  id: string,
  overrides: Partial<CreateSandboxRequest> = {},
): Promise<Sandbox> {
  return withSpan("sandbox.fork", { "spaces.sandbox_id": id }, () => forkInner(id, overrides));
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

  const newId_ = newSandboxId();
  const type = overrides.type ?? source.type;
  await store.insert({
    id: newId_,
    name: overrides.name ?? `${source.name} (fork)`,
    state: "cloning",
    type,
    labels: overrides.labels ?? source.labels,
    env: overrides.env ?? {},
    ttlSeconds: overrides.ttlSeconds ?? 3600,
    archiveAfter: ttlToArchiveAfter(overrides.ttlSeconds ?? 3600),
    forkOf: id,
  });
  await store.event(newId_, "sandbox.fork", { from: id });
  await store.event(id, "sandbox.forked", { into: newId_ });

  void provision(newId_, type, overrides.env ?? {}, id).catch(() => {});

  return (await store.get(newId_))!;
}

/**
 * Run the operator's bootstrap snippet. A failure is recorded as an event and
 * ignored: a sandbox that boots is still useful without extra packages.
 */
async function runBootstrap(id: string, ref: string): Promise<void> {
  const script = config.bootstrap.trim();

  if (!script || config.driver === "mock") return;

  const started = Date.now();
  try {
    const result = await driver().exec(ref, {
      command: script,
      timeoutSeconds: config.bootstrapTimeoutSeconds,
      // Operator plumbing: `apk add` and friends need root.
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

/**
 * boat's `setupScript`: run once, after the sandbox is ready, as the sandbox
 * user. Its outcome is recorded as an event rather than surfaced as
 * `setupStatus`, which this server does not implement — see docs/decision/0021.
 */
async function runSetupScript(id: string, ref: string, script: string): Promise<void> {
  if (config.driver === "mock") return;

  const started = Date.now();
  try {
    const result = await driver().exec(ref, {
      command: script,
      timeoutSeconds: config.bootstrapTimeoutSeconds,
    });
    const payload: { ms: number; exitCode: number | null; stderr?: string } = {
      ms: Date.now() - started,
      exitCode: result.exitCode,
    };

    if (result.exitCode !== 0) payload.stderr = result.stderr.slice(0, 2000);

    await store.event(id, "sandbox.setup_script", payload);
  } catch (error) {
    await store.event(id, "sandbox.setup_script_failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function destroySandbox(id: string): Promise<void> {
  return withSpan("sandbox.destroy", { "spaces.sandbox_id": id }, () => destroyInner(id));
}

async function destroyInner(id: string): Promise<void> {
  await requireSandbox(id);
  try {
    await driver().destroy(id);
  } catch {
    // Deleting a sandbox whose machine already died must still succeed.
  }
  // Published ports are host-side state; the rows must not outlive the machine
  // or the host port stays reserved in the allocator.
  await store.deletePortsOf(id);
  await store.event(id, "sandbox.deleted");
  await store.remove(id);
}

/**
 * Power-cycle a sandbox that stopped answering. The disk is untouched, which is
 * exactly what a microVM restart is.
 */
export async function recoverSandbox(id: string) {
  const sandbox = await requireSandbox(id);

  if (sandbox.state === "archived") {
    throw new ServiceError(
      "sandbox_not_ready",
      "no_machine: this sandbox has no machine. Resume it instead.",
    );
  }

  // A reachable sandbox needs no recovery.
  const reachable = await driver()
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
    // boat refuses a second recover within 10 minutes.

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
    await driver().restart(id);
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
