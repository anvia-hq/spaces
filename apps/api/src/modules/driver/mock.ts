import type { FileEntry, FileMatch } from "@spaces/shared/files";
import { DriverUnsupported } from "../../errors.ts";
import type {
  CreateOptions,
  DriverHandle,
  ExecRequest,
  ExecResult,
  MachineSpec,
  SandboxDriver,
} from "./types.ts";

/**
 * In-process driver. No KVM, no SSH — it models the lifecycle so the API and
 * UI are fully exercisable on any machine.
 */
export class MockDriver implements SandboxDriver {
  readonly kind = "mock";
  // Files need a guest transport; the mock has none, so it reports the gap
  // honestly instead of pretending.
  readonly capabilities = { exec: true, files: false, persistence: true };

  /** ref -> booted, at the size the caller resolved. */
  private live = new Map<string, { size: MachineSpec; bootedAt: number }>();

  private async jitter(ms = 120) {
    await Bun.sleep(ms + Math.random() * ms);
  }

  private handle(ref: string): DriverHandle {
    const n = (Math.abs(hash(ref)) % 250) + 10;
    const m = (Math.abs(hash(ref + "b")) % 250) + 10;
    return { ref, url: `https://mock-${ref.slice(-6)}.spaces.local`, ip: `10.64.${n}.${m}` };
  }

  async create(o: CreateOptions): Promise<DriverHandle> {
    await this.jitter();
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    return this.handle(o.sandboxId);
  }

  async resume(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    await this.jitter(80);
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
    return this.handle(o.sandboxId);
  }

  async fork(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    await this.jitter(150);
    this.live.set(o.sandboxId, { size: o.size, bootedAt: Date.now() });
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
  }

  async snapshot(_sandboxId: string, snapshotId: string) {
    await this.jitter(90);
    return { ref: `mock://snap/${snapshotId}`, sizeBytes: 30 * 1024 * 1024 };
  }

  async destroySnapshot(_ref: string): Promise<void> {
    await this.jitter(30);
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

    // A few commands are answered with plausible machine output; anything else
    // echoes so the UI has something honest to render.
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
    _sandboxId: string,
    _mapping: { bind: string; hostPort: number; guestPort: number },
    _mode?: "restart" | "next-start",
  ): Promise<void> {
    return this.filesUnsupported();
  }
  async unpublishPort(): Promise<void> {
    return this.filesUnsupported();
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

  /* ---- processes: not modelled by the fixture ---- */

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

  /* ---- file operations: not modelled by the fixture ---- */

  private filesUnsupported(): never {
    throw new DriverUnsupported(
      "Guest operations",
      "the mock driver has no guest. Run with the microsandbox driver (the default) " +
        "for files, processes and background commands.",
    );
  }

  async readFile(): Promise<Uint8Array> {
    return this.filesUnsupported();
  }
  async writeFile(): Promise<void> {
    this.filesUnsupported();
  }
  async listFiles(): Promise<FileEntry[]> {
    return this.filesUnsupported();
  }
  async fileInfo(): Promise<FileEntry> {
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
