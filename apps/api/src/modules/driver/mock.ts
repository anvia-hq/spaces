import type { FileEntry, FileMatch } from "@spaces/shared/files";
import { DriverFailure, DriverUnsupported } from "../../errors.ts";
import type {
  CreateOptions,
  DriverHandle,
  ExecRequest,
  ExecResult,
  MachineSpec,
  ProxyRequest,
  ProxyResponse,
  SandboxDriver,
} from "./types.ts";

export const mockRestores: { sandboxId: string; fromRef: string }[] = [];

export class MockDriver implements SandboxDriver {
  readonly kind = "mock";
  readonly capabilities: SandboxDriver["capabilities"] = {
    exec: true,
    files: false,
    persistence: true,
    networkPolicy: true,
  };

  private live = new Map<string, { size: MachineSpec; bootedAt: number }>();

  private snapshots = new Set<string>();

  private published = new Map<number, { sandboxId: string; guestPort: number }>();

  private async jitter(ms = 120) {
    await Bun.sleep(ms + Math.random() * ms);
  }

  private handle(ref: string): DriverHandle {
    const n = (Math.abs(hash(ref)) % 250) + 10;
    const m = (Math.abs(hash(ref + "b")) % 250) + 10;
    return { ref, url: `https://mock-${ref.slice(-6)}.spaces.local`, ip: `10.64.${n}.${m}` };
  }

  private recordPorts(sandboxId: string, ports?: CreateOptions["ports"]) {
    if (!ports) return;

    for (const port of ports) {
      this.published.set(port.hostPort, { sandboxId, guestPort: port.guestPort });
    }
  }

  async create(o: CreateOptions): Promise<DriverHandle> {
    await this.jitter();
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    this.recordPorts(o.sandboxId, o.ports);
    return this.handle(o.sandboxId);
  }

  async resume(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    await this.jitter(80);
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    return this.handle(o.sandboxId);
  }

  async fork(o: Omit<CreateOptions, "network"> & { fromRef: string }): Promise<DriverHandle> {
    await this.jitter(150);
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    this.recordPorts(o.sandboxId, o.ports);
    return this.handle(o.sandboxId);
  }

  async restore(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    await this.jitter(150);

    if (!this.snapshots.has(o.fromRef)) {
      throw new DriverFailure(`mock: no snapshot disk ${o.fromRef}`);
    }

    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    this.recordPorts(o.sandboxId, o.ports);
    mockRestores.push({ sandboxId: o.sandboxId, fromRef: o.fromRef });
    return this.handle(o.sandboxId);
  }

  async stop(sandboxId: string): Promise<{ diskRef: string }> {
    await this.jitter(60);
    this.live.delete(sandboxId);
    return { diskRef: `mock://disk/${sandboxId}` };
  }

  async destroy(sandboxId: string): Promise<void> {
    await this.jitter(40);
    this.live.delete(sandboxId);

    for (const [hostPort, target] of this.published) {
      if (target.sandboxId === sandboxId) this.published.delete(hostPort);
    }
  }

  async snapshot(_sandboxId: string, snapshotId: string) {
    await this.jitter(90);
    const ref = `mock://snap/${snapshotId}`;
    this.snapshots.add(ref);
    return { ref, sizeBytes: 4 * 1024 ** 3 };
  }

  async destroySnapshot(ref: string): Promise<void> {
    await this.jitter(30);
    this.snapshots.delete(ref);
  }

  async isRunning(ref: string): Promise<boolean> {
    return this.live.has(ref);
  }

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    const machine = this.live.get(ref);

    if (!machine) throw new Error("machine is not running");

    const { size } = machine;
    const startedAt = new Date().toISOString();
    await this.jitter(90);
    const finishedAt = new Date().toISOString();

    const cmd = request.command.trim();
    let stdout = "";
    let exitCode = 0;

    if (/^(uname|uname -a)$/.test(cmd)) {
      stdout = "Linux spaces-mock 6.12.0-spaces #1 SMP x86_64 GNU/Linux\n";
    } else if (/^nproc$/.test(cmd)) {
      stdout = `${size.vcpu}\n`;
    } else if (/^free -m$/.test(cmd)) {
      stdout = `               total        used\nMem:           ${size.memMib}         128\n`;
    } else if (cmd.includes("exit 1")) {
      exitCode = 1;
      stdout = "";
    } else {
      stdout = `${cmd}\n`;
    }

    return {
      exitCode,
      signal: null,
      stdout,
      stderr: exitCode === 0 ? "" : "mock: command exited non-zero\n",
      timedOut: false,
      startedAt,
      finishedAt,
    };
  }

  async restart(): Promise<void> {
    return this.filesUnsupported();
  }
  async guestIp(): Promise<string | null> {
    return null;
  }
  async publishPort(
    sandboxId: string,
    mapping: { bind: string; hostPort: number; guestPort: number },
    _mode?: "restart" | "next-start",
  ): Promise<void> {
    this.published.set(mapping.hostPort, { sandboxId, guestPort: mapping.guestPort });
  }
  async unpublishPort(
    _sandboxId: string,
    mapping: { hostPort: number; guestPort: number },
  ): Promise<void> {
    this.published.delete(mapping.hostPort);
  }
  async listeningPorts(): Promise<number[] | null> {
    return [...this.published.keys()];
  }
  async isPortFree(port: number): Promise<boolean> {
    return !this.published.has(port);
  }
  async forgetPort(hostPort: number): Promise<void> {
    this.published.delete(hostPort);
  }
  async proxyHttp(request: ProxyRequest): Promise<ProxyResponse> {
    const target = this.published.get(request.hostPort);

    if (!target) throw new DriverFailure(`mock: nothing published on ${request.hostPort}`);

    const text = `mock ${target.sandboxId}:${target.guestPort} ${request.method} ${request.path}`;
    const body = new Blob([new TextEncoder().encode(text)]).stream();
    return {
      status: 200,
      statusText: "OK",
      headers: [["content-type", "text/plain"]],
      body: body as ReadableStream<Uint8Array>,
    };
  }
  async restoreTemporary(): Promise<{ ref: string }> {
    return this.filesUnsupported();
  }
  async removeTemporary(): Promise<void> {
    return this.filesUnsupported();
  }
  async listSnapshotTree(): Promise<{ path: string; kind: string; size?: number }[]> {
    return this.filesUnsupported();
  }
  async readSnapshotEntry(): Promise<{ kind: "file" | "dir"; bytes: Uint8Array }> {
    return this.filesUnsupported();
  }

  async startProcess(): Promise<{ pid: number; logPath: string; errLogPath: string }> {
    return this.filesUnsupported();
  }
  async processState(): Promise<{
    running: boolean;
    exitCode: number | null;
    pid: number | null;
    known: boolean;
  }> {
    return this.filesUnsupported();
  }
  async killProcess(): Promise<{ signaled: boolean }> {
    return this.filesUnsupported();
  }
  async readProcessOutput(): Promise<{
    stdout: Uint8Array;
    stderr: Uint8Array;
    stdoutNextOffset: number;
    stderrNextOffset: number;
  }> {
    return this.filesUnsupported();
  }
  async listProcesses(): Promise<
    {
      pid: number;
      parentPid: number;
      user: string;
      memoryMB: number;
      command: string;
      commandId: string | null;
    }[]
  > {
    return this.filesUnsupported();
  }

  private filesUnsupported(): never {
    throw new DriverUnsupported(
      "Guest operations",
      "the mock driver has no guest. Run with the microsandbox driver (the default) " +
        "for files, processes and background commands.",
    );
  }

  async readFile(_ref: string, _path: string): Promise<Uint8Array> {
    return this.filesUnsupported();
  }
  async writeFile(_ref: string, _path: string, _bytes: Uint8Array): Promise<void> {
    this.filesUnsupported();
  }
  async listFiles(): Promise<FileEntry[]> {
    return this.filesUnsupported();
  }
  async fileInfo(_ref: string, _path: string): Promise<FileEntry> {
    return this.filesUnsupported();
  }
  async makeFolder(): Promise<void> {
    this.filesUnsupported();
  }
  async setPermissions(): Promise<void> {
    this.filesUnsupported();
  }
  async movePath(): Promise<void> {
    this.filesUnsupported();
  }
  async removePath(): Promise<void> {
    this.filesUnsupported();
  }
  async searchFiles(): Promise<string[]> {
    return this.filesUnsupported();
  }
  async findInFiles(): Promise<{ matches: FileMatch[]; truncated: boolean }> {
    return this.filesUnsupported();
  }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
