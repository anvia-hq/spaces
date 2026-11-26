import type { NetworkPolicy, SandboxType } from "@spaces/shared/sandbox";
import type { FileEntry, FileMatch } from "@spaces/shared/files";
import type { DriverMethod } from "@spaces/shared/runtime";

export interface DriverHandle {
  ref: string;
  url: string | null;
  ip: string | null;
}

export interface ExecRequest {
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  env?: Record<string, string>;
  args?: string[];
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
  type: SandboxType;
  size: MachineSpec;
  ports?: PortMapping[];
  fromRef?: string;
  env?: Record<string, string>;
  network?: NetworkPolicy;
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
    exec: boolean;
    files: boolean;
    persistence: boolean;
    networkPolicy?: boolean;
  };

  create(options: CreateOptions): Promise<DriverHandle>;
  resume(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>;
  fork(options: Omit<CreateOptions, "network"> & { fromRef: string }): Promise<DriverHandle>;
  restore(options: CreateOptions & { fromRef: string }): Promise<DriverHandle>;

  stop(sandboxId: string): Promise<{ diskRef: string }>;
  destroy(sandboxId: string): Promise<void>;

  snapshot(sandboxId: string, snapshotId: string): Promise<{ ref: string; sizeBytes: number }>;
  destroySnapshot(ref: string): Promise<void>;

  isRunning(ref: string): Promise<boolean>;

  exec(ref: string, request: ExecRequest): Promise<ExecResult>;

  guestIp(sandboxId: string): Promise<string | null>;
  publishPort(
    sandboxId: string,
    mapping: { bind: string; hostPort: number; guestPort: number },
    mode?: "restart" | "next-start",
  ): Promise<void>;
  unpublishPort(sandboxId: string, mapping: { hostPort: number; guestPort: number }): Promise<void>;

  restart(sandboxId: string): Promise<void>;

  restoreTemporary(fromRef: string, name: string): Promise<{ ref: string }>;
  removeTemporary(ref: string): Promise<void>;
  listSnapshotTree(
    ref: string,
    root: string,
    limit: number,
  ): Promise<{ path: string; kind: string; size?: number }[]>;
  readSnapshotEntry(
    ref: string,
    path: string,
  ): Promise<{ kind: "file" | "dir"; bytes: Uint8Array }>;

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

  readFile(ref: string, path: string): Promise<Uint8Array>;
  writeFile(ref: string, path: string, bytes: Uint8Array): Promise<void>;
  listFiles(ref: string, path: string): Promise<FileEntry[]>;
  fileInfo(ref: string, path: string): Promise<FileEntry>;
  makeFolder(ref: string, path: string, mode?: string): Promise<void>;
  setPermissions(ref: string, path: string, mode: string): Promise<void>;
  movePath(ref: string, source: string, destination: string, overwrite: boolean): Promise<void>;
  removePath(ref: string, path: string, recursive: boolean): Promise<void>;
  searchFiles(ref: string, path: string, pattern: string): Promise<string[]>;
  findInFiles(
    ref: string,
    path: string,
    pattern: string,
    options: { ignoreCase: boolean; maxResults: number },
  ): Promise<{ matches: FileMatch[]; truncated: boolean }>;

  listeningPorts(): Promise<number[] | null>;
  isPortFree(port: number, bind: string): Promise<boolean>;
  forgetPort(hostPort: number): Promise<void>;
  proxyHttp(request: ProxyRequest): Promise<ProxyResponse>;
}

export interface DriverTransport {
  call(method: DriverMethod, args: unknown[]): Promise<unknown>;
}

export interface AttachedDriver {
  driver: SandboxDriver;
  label: string;
}
