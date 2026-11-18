import { newId } from "@spaces/shared/errors";
import { SANDBOX_WORKDIR, resolveSandboxPath } from "@spaces/shared/files";
import { iso, store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import { driverOfSandbox } from "../runtimes/service.ts";
import { requireLiveSandbox, requireSandbox } from "../sandboxes/service.ts";

/** Guest layout of the process runtime; mirrors MicrosandboxDriver.PROC_DIR. */
export const SANDBOX_PROC_DIR = "/tmp/.spaces/proc";

/**
 * Public `processId` is the guest pid; our runtime keys state by command id, so
 * resolve one to the other. The recorded pid is consulted first because a
 * finished process no longer appears in the live table.
 */
async function resolveProcess(id: string, pid: number) {
  const { ref, driver } = await requireLiveSandbox(id);
  const recorded = await store.findCommandByPid(id, pid);

  if (recorded) return { ref, driver, commandId: recorded.id, command: recorded.command };

  const processes = await driver.listProcesses(ref);
  const match = processes.find((p) => p.pid === pid);

  if (!match) throw new ServiceError("not_found", `no process ${pid} in sandbox ${id}`);

  return { ref, driver, commandId: match.commandId, command: match.command };
}

/** boat's CommandRecord status, from the row and whatever the guest last said. */
function commandStatusOf(
  row: { killed: boolean; timedOut: number },
  finished: boolean,
  live?: { running: boolean; known: boolean },
): "running" | "exited" | "timed_out" | "killed" | "lost" {
  if (live && live.known && live.running) return "running";

  if (!finished && live?.known !== false) return "running";

  if (row.timedOut === 1) return "timed_out";

  if (row.killed) return "killed";

  if (live?.known === false) return "lost";

  return "exited";
}

/** boat's CommandRecord, derived from the row plus the guest's live state. */
export function commandRecord(
  row: {
    id: string;
    sandboxId: string;
    command: string;
    cwd: string | null;
    pid: number | null;
    mode: string;
    killed: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: number;
    startedAt: Date;
    finishedAt: Date | null;
  },
  live?: { running: boolean; known: boolean },
) {
  const finished = row.finishedAt !== null;
  const status = commandStatusOf(row, finished, live);

  return {
    commandId: row.id,
    sandboxId: row.sandboxId,
    command: row.command,
    cwd: row.cwd,
    mode: row.mode as "sync" | "stream" | "detached" | "process",
    processId: row.pid,
    status: status as "running" | "exited" | "timed_out" | "failed" | "killed" | "lost",
    exitCode: row.exitCode,
    signal: null as string | null,
    stdoutBytes: Buffer.byteLength(row.stdout, "utf8"),
    stderrBytes: Buffer.byteLength(row.stderr, "utf8"),
    outputTruncated: false,
    startedAt: row.startedAt.toISOString(),
    finishedAt: iso(row.finishedAt),
  };
}

/** Throws unless the sandbox can take commands at all. */
export async function assertRunnable(id: string) {
  const sandbox = await requireSandbox(id);

  if (!["ready", "running", "idle"].includes(sandbox.state)) {
    throw new ServiceError(
      "sandbox_not_ready",
      `sandbox is ${sandbox.state}; resume or recover it first`,
    );
  }
}

/** The synchronous path: run to completion and answer with boat's `command.finished`. */
export async function runSandboxCommand(
  id: string,
  request: { command: string; cwd?: string; timeoutSeconds: number },
) {
  assertRunnable(id);

  const commandId = newId("cmd");
  const startedAt = new Date().toISOString();
  await store.insertCommand({
    id: commandId,
    sandboxId: id,
    command: request.command,
    cwd: request.cwd ?? null,
    startedAt,
    mode: "sync",
  });

  const driver = await driverOfSandbox(id);
  const result = await driver.exec((await store.raw(id))!.driverRef ?? `msb:${id}`, {
    command: request.command,
    cwd: request.cwd,
    timeoutSeconds: request.timeoutSeconds,
    env: await store.env(id),
  });

  await store.finishCommand(commandId, {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    finishedAt: result.finishedAt,
  });

  return {
    ok: true as const,
    type: "command.finished" as const,
    success: result.exitCode === 0 && !result.timedOut,
    commandId,
    exitCode: result.exitCode,
    signal: result.signal,
    oomKilled: false,
    stdout: result.stdout,
    stderr: result.stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
    timedOut: result.timedOut,
    cwd: request.cwd ?? SANDBOX_WORKDIR,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
}

/** Launch a command that outlives the request, returning boat's `command.started`. */
export async function startSandboxProcess(
  id: string,
  request: { command: string; cwd?: string; timeoutSeconds: number },
  mode: "detached" | "stream" = "detached",
) {
  const { ref, driver } = await requireLiveSandbox(id);
  const cwdResult = resolveSandboxPath(request.cwd ?? SANDBOX_WORKDIR);

  if (!cwdResult.ok) {
    throw new ServiceError(
      "invalid_path",
      "invalid_path: cwd must resolve under /home/user or /tmp",
    );
  }

  const commandId = newId("cmd");
  const startedAt = new Date().toISOString();
  const started = await driver.startProcess(ref, {
    processId: commandId,
    command: request.command,
    cwd: cwdResult.path,
    timeoutSeconds: request.timeoutSeconds,
  });

  await store.insertCommand({
    id: commandId,
    sandboxId: id,
    command: request.command,
    cwd: cwdResult.path,
    startedAt,
    pid: started.pid,
    mode,
  });

  return {
    commandId,
    processId: started.pid,
    pid: started.pid,
    command: request.command,
    cwd: cwdResult.path,
    startedAt,
    logPath: started.logPath,
    errLogPath: started.errLogPath,
  };
}

export async function sandboxProcessState(id: string, processId: string) {
  const pid = Number(processId);
  const { ref, driver, commandId } = await resolveProcess(id, pid);

  if (!commandId) throw new ServiceError("not_found", `no tracked process ${pid}`);

  return driver.processState(ref, commandId);
}

export async function readSandboxProcessOutput(
  id: string,
  processId: string,
  offsets?: { stdoutOffset?: number; stderrOffset?: number },
) {
  const pid = Number(processId);
  const { ref, driver, commandId } = await resolveProcess(id, pid);

  if (!commandId) throw new ServiceError("not_found", `no tracked process ${pid}`);

  return driver.readProcessOutput(ref, commandId, offsets);
}

function liveStatusOf(state: { running: boolean; known: boolean } | null) {
  if (!state) return "lost" as const;

  if (state.running) return "running" as const;

  return state.known ? ("exited" as const) : ("lost" as const);
}

/** Full CommandStatusResponse body for GET /commands/{processId}. */
export async function sandboxCommandStatus(
  id: string,
  processId: string,
  query: { tailBytes?: number; stdoutOffset?: number; stderrOffset?: number },
) {
  const pid = Number(processId);
  const { ref, driver, commandId } = await resolveProcess(id, pid);

  if (!commandId) throw new ServiceError("not_found", `no tracked process ${pid}`);

  const row = await store.commandById(commandId);
  const usingOffsets = query.stdoutOffset !== undefined || query.stderrOffset !== undefined;

  const output = await driver
    .readProcessOutput(ref, commandId, {
      stdoutOffset: query.stdoutOffset ?? 0,
      stderrOffset: query.stderrOffset ?? 0,
    })
    .catch(() => null);
  const state = await driver.processState(ref, commandId).catch(() => null);

  // Offsets: only what was written since the requested byte position. Otherwise
  // the tail of both logs, capped by tailBytes.
  let stdoutBytes = output?.stdout ?? new Uint8Array();
  let stderrBytes = output?.stderr ?? new Uint8Array();
  let stdoutOffset = query.stdoutOffset ?? 0;
  let stderrOffset = query.stderrOffset ?? 0;

  if (!usingOffsets) {
    const cap = query.tailBytes ?? 8 * 1024 * 1024;

    if (stdoutBytes.byteLength > cap) {
      stdoutOffset = stdoutBytes.byteLength - cap;
      stdoutBytes = stdoutBytes.subarray(stdoutOffset);
    }

    if (stderrBytes.byteLength > cap) {
      stderrOffset = stderrBytes.byteLength - cap;
      stderrBytes = stderrBytes.subarray(stderrOffset);
    }
  }

  const status = liveStatusOf(state);

  return {
    type: "command.status",
    processId: pid,
    pid: state?.pid ?? pid,
    status: status as "running" | "exited" | "lost",
    known: state?.known ?? false,
    running: state?.running ?? false,
    exitCode: state?.exitCode ?? row?.exitCode ?? null,
    command: row?.command ?? null,
    cwd: row?.cwd ?? null,
    startedAt: row?.startedAt.toISOString() ?? null,
    finishedAt: iso(row?.finishedAt ?? null),
    stdout: Buffer.from(stdoutBytes).toString("utf8"),
    stderr: Buffer.from(stderrBytes).toString("utf8"),
    stdoutTruncated: false,
    stderrTruncated: false,
    logPath: `${SANDBOX_PROC_DIR}/${commandId}/out`,
    errLogPath: `${SANDBOX_PROC_DIR}/${commandId}/err`,
    stdoutOffset,
    stderrOffset,
    stdoutNextOffset: stdoutOffset + stdoutBytes.byteLength,
    stderrNextOffset: stderrOffset + stderrBytes.byteLength,
    more: false,
  };
}

export async function killSandboxProcess(id: string, processId: string) {
  const pid = Number(processId);
  const { ref, driver, commandId } = await resolveProcess(id, pid);
  const { signaled } = await driver.killProcess(ref, commandId ?? processId);

  if (commandId) {
    const existing = await store.commandById(commandId);
    // A DELETE on something that already ended must not rewrite its history:
    // it only signals, so the natural exit stays `exited`.

    if (signaled || existing?.finishedAt === null) {
      const [output, state] = await Promise.all([
        driver.readProcessOutput(ref, commandId).catch(() => null),
        driver.processState(ref, commandId).catch(() => null),
      ]);
      await store.finishCommand(commandId, {
        exitCode: state?.exitCode ?? existing?.exitCode ?? null,
        stdout: output ? Buffer.from(output.stdout).toString("utf8") : (existing?.stdout ?? ""),
        stderr: output ? Buffer.from(output.stderr).toString("utf8") : (existing?.stderr ?? ""),
        timedOut: false,
        finishedAt: new Date().toISOString(),
      });

      if (signaled) await store.markCommandKilled(commandId);
    }
  }

  const row = commandId ? await store.commandById(commandId) : null;
  return {
    processId: pid,
    running: false as const,
    signaled,
    command: row ? commandRecord(row) : null,
  };
}

export async function listSandboxProcesses(id: string) {
  const { ref, driver } = await requireLiveSandbox(id);
  const processes = await driver.listProcesses(ref);
  return {
    live: true as const,
    sampledAt: new Date().toISOString(),
    total: processes.length,
    processes: processes.slice(0, 500),
  };
}

export async function listCommandHistory(sandboxId: string) {
  return (await store.listCommands(sandboxId)).map((row) => commandRecord(row));
}

async function requireCommand(sandboxId: string, commandId: string) {
  await requireSandbox(sandboxId);
  const row = await store.commandById(commandId);

  if (!row || row.sandboxId !== sandboxId) {
    throw new ServiceError("not_found", `no command ${commandId} for sandbox ${sandboxId}`);
  }

  return row;
}

export async function commandHistoryInfo(sandboxId: string, commandId: string) {
  return commandRecord(await requireCommand(sandboxId, commandId));
}

/**
 * Read a stored log from a byte offset, at most 1 MiB per call, so a client can
 * page through output that is far larger than one response.
 */
export async function commandHistoryLogs(
  sandboxId: string,
  commandId: string,
  query: {
    stream?: "stdout" | "stderr";
    offset?: number;
    limit?: number;
    encoding?: "utf8" | "base64";
  },
) {
  const row = await requireCommand(sandboxId, commandId);
  const stream = query.stream ?? "stdout";
  const encoding = query.encoding ?? "base64";
  const limit = Math.min(query.limit ?? 1024 * 1024, 1024 * 1024);

  const bytes = Buffer.from(stream === "stdout" ? row.stdout : row.stderr, "utf8");
  const offset = Math.min(query.offset ?? 0, bytes.byteLength);
  const slice = bytes.subarray(offset, offset + limit);
  const nextOffset = offset + slice.byteLength;

  return {
    type: "command.logs" as const,
    commandId,
    stream,
    offset,
    nextOffset,
    size: bytes.byteLength,
    encoding,
    data: encoding === "base64" ? slice.toString("base64") : slice.toString("utf8"),
    done: row.finishedAt !== null && nextOffset >= bytes.byteLength,
  };
}
