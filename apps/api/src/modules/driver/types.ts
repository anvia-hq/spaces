import type { SandboxType } from "@spaces/shared/sandbox";
import type { FileEntry, FileMatch } from "@spaces/shared/files";
import type { DriverMethod } from "@spaces/shared/runtime";

/** A live machine handle returned by any driver lifecycle call. */
export interface DriverHandle {
  /** Opaque pointer the driver needs later (VM dir, container id, ...). */
  ref: string;
  /** Reachable address for the machine, if the driver exposes one. */
  url: string | null;
  ip: string | null;
}

export interface ExecRequest {
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  env?: Record<string, string>;
  /**
   * Positional arguments for the script, reachable as `$1`, `$2`, ... Values
   * are passed as argv, never interpolated, so arbitrary text (keys, paths with
   * quotes) is safe.
   */
  args?: string[];
  /**
   * Whose credentials the command runs with. Defaults to `user`, matching boat;
   * `root` is for operator plumbing that must change the system — the bootstrap
   * snippet, package installs, sshd provisioning.
   */
  runAs?: "user" | "root";
}

export interface ExecResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
}

/** A host:guest port mapping applied at create time. */
export interface PortMapping {
  bind: string;
  hostPort: number;
  guestPort: number;
}

export interface MachineSpec {
  vcpu: number;
  memMib: number;
  diskGb: number;
}

export interface CreateOptions {
  sandboxId: string;
  /** The preset name; kept for the row, the events and the mock's answers. */
  type: SandboxType;
  /**
   * The resolved vCPU/RAM/disk of that preset, read from the operator's own
   * table at create time. Drivers size the machine from this, never from a
   * built-in table (docs/decision/0034).
   */
  size: MachineSpec;
  /** Ports published as part of the create call, so no restart is needed. */
  ports?: PortMapping[];
  /** Boot from this snapshot/disk image instead of the base image. */
  fromRef?: string;
  env?: Record<string, string>;
}

export interface ProxyRequest {
  hostPort: number;
  method: string;
  path: string;
  headers: [string, string][];
  body: Uint8Array | null;
}

export interface ProxyResponse {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: ReadableStream<Uint8Array> | null;
}

export interface SandboxDriver {
  readonly kind: string;
  readonly capabilities: {
    /** Can run commands inside a running sandbox. */
    exec: boolean;
    /** Can read/write files inside a running sandbox. */
    files: boolean;
    /** Can persist a stopped sandbox's disk and restore it later. */
    persistence: boolean;
  };

  /** Cold start a fresh machine. */
  create(options: CreateOptions): Promise<DriverHandle>;
  /** Boot from an existing disk image (boat `resume`). */
  resume(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>;
  /** Clone an existing disk image into a new machine (boat `fork`). */
  fork(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>;
  /** Boot a new sandbox from a snapshot artifact's disk, leaving the snapshot intact. */
  restore(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>;

  /** Flush state, stop the machine, and return the disk ref to boot from later. */
  stop(sandboxId: string): Promise<{ diskRef: string }>;
  /** Delete all machine state including any saved disk. */
  destroy(sandboxId: string): Promise<void>;

  /** Persist the current disk as an immutable named snapshot. */
  snapshot(sandboxId: string, snapshotId: string): Promise<{ ref: string; sizeBytes: number }>;
  /** Delete a snapshot's stored bytes. */
  destroySnapshot(ref: string): Promise<void>;

  /** True when the machine process is alive. */
  isRunning(ref: string): Promise<boolean>;

  exec(ref: string, request: ExecRequest): Promise<ExecResult>;

  /** IPv4 address of the guest, or null when it has no network device. */
  guestIp(sandboxId: string): Promise<string | null>;
  /**
   * Publish a guest port on the host. `mode` decides what happens when the
   * mapping needs a restart: `restart` applies it now (killing guest
   * processes), `next-start` saves it for the next boot.
   */
  publishPort(
    sandboxId: string,
    mapping: { bind: string; hostPort: number; guestPort: number },
    mode?: "restart" | "next-start",
  ): Promise<void>;
  unpublishPort(sandboxId: string, mapping: { hostPort: number; guestPort: number }): Promise<void>;

  /** Power-cycle the machine without touching its disk (recover). */
  restart(sandboxId: string): Promise<void>;

  /** Boot a throwaway sandbox from a snapshot ref, for reading its files. */
  restoreTemporary(fromRef: string, name: string): Promise<{ ref: string }>;
  removeTemporary(ref: string): Promise<void>;
  listSnapshotTree(
    ref: string,
    root: string,
    limit: number,
  ): Promise<{ path: string; kind: string; size?: number }[]>;
  /** File bytes, or the subtree as a tar. */
  readSnapshotEntry(
    ref: string,
    path: string,
  ): Promise<{ kind: "file" | "dir"; bytes: Uint8Array }>;

  /* ---- background processes ---- */

  /** Launch a command outliving the exec that started it. */
  startProcess(
    ref: string,
    options: { processId: string; command: string; cwd: string; timeoutSeconds: number },
  ): Promise<{ pid: number; logPath: string; errLogPath: string }>;
  processState(
    ref: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode: number | null; pid: number | null; known: boolean }>;
  killProcess(
    ref: string,
    processId: string,
    graceSeconds?: number,
  ): Promise<{ signaled: boolean }>;
  /** Raw bytes, optionally from a byte offset so a poller only fetches new output. */
  readProcessOutput(
    ref: string,
    processId: string,
    offsets?: { stdoutOffset?: number; stderrOffset?: number },
  ): Promise<{
    stdout: Uint8Array;
    stderr: Uint8Array;
    stdoutNextOffset: number;
    stderrNextOffset: number;
  }>;
  listProcesses(ref: string): Promise<
    {
      pid: number;
      parentPid: number;
      user: string;
      memoryMB: number;
      command: string;
      commandId: string | null;
    }[]
  >;

  /* ---- file operations (all paths are absolute and pre-validated) ---- */

  readFile(ref: string, path: string): Promise<Uint8Array>;
  writeFile(ref: string, path: string, bytes: Uint8Array): Promise<void>;
  /** One level, sorted by name, symlinks not followed. */
  listFiles(ref: string, path: string): Promise<FileEntry[]>;
  fileInfo(ref: string, path: string): Promise<FileEntry>;
  makeFolder(ref: string, path: string, mode?: string): Promise<void>;
  /** Change permission bits; ownership is left alone. */
  setPermissions(ref: string, path: string, mode: string): Promise<void>;
  movePath(ref: string, source: string, destination: string, overwrite: boolean): Promise<void>;
  removePath(ref: string, path: string, recursive: boolean): Promise<void>;
  /** Glob match on entry names under `path`. */
  searchFiles(ref: string, path: string, pattern: string): Promise<string[]>;
  /** Content search, one match per line. */
  findInFiles(
    ref: string,
    path: string,
    pattern: string,
    options: { ignoreCase: boolean; maxResults: number },
  ): Promise<{ matches: FileMatch[]; truncated: boolean }>;

  /* ---- the host's published ports ---- */

  /** Ports already listening on the host, or null when they have to be probed one by one. */
  listeningPorts(): Promise<number[] | null>;
  isPortFree(port: number, bind: string): Promise<boolean>;
  /** Drop whatever the driver holds open for a host port that is no longer published. */
  forgetPort(hostPort: number): Promise<void>;
  /** Send one HTTP request to a host port the runtime published, and stream the answer back. */
  proxyHttp(request: ProxyRequest): Promise<ProxyResponse>;
}

export interface DriverTransport {
  call(method: DriverMethod, args: unknown[]): Promise<unknown>;
}

export interface AttachedDriver {
  driver: SandboxDriver;
  label: string;
}
