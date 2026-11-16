import { MACHINE_SIZES } from "@spaces/shared/sandbox";
import { SANDBOX_WORKDIR } from "@spaces/shared/files";
import { config } from "../../config.ts";
import type { FileEntry, FileMatch } from "@spaces/shared/files";
import type {
  CreateOptions,
  DriverHandle,
  ExecRequest,
  ExecResult,
  PortMapping,
  SandboxDriver,
} from "./types.ts";
import { DriverFailure } from "../../errors.ts";
import { parseKeyValues, runRemote } from "./ssh.ts";

export interface MicrosandboxDriverOptions {
  /** SSH destination of the host running `msb`, or `local`. */
  host: string;
  /** Path to the msb binary. `~` expands on both local and remote transports. */
  msbPath?: string;
  /** OCI image used for new sandboxes. */
  image?: string;
  timeoutMs?: number;
}

/** msb status values that mean the guest is up. */
const RUNNING_STATES = new Set(["Running", "Started", "Ready"]);

/**
 * The sandbox user, as boat defines it.
 *
 * Commands used to run as root with `HOME=/root`, and `/home/user` was
 * root-owned, so files the API wrote were not the user's and anything that
 * cared about uid (package managers, npm, git) behaved differently from boat.
 */
const GUEST_USER = "user";
const GUEST_UID = 1000;
const GUEST_GID = 1000;
const GUEST_HOME = SANDBOX_WORKDIR;

/**
 * Create the sandbox user and take ownership of the work directory.
 *
 * Idempotent, and run on create and resume: images differ in whether they ship
 * `adduser` (Alpine) or `useradd` (Ubuntu), and a restored disk may predate this.
 */
const GUEST_INIT = `
mkdir -p ${sq(GUEST_HOME)} || exit 9
if ! id -u ${sq(GUEST_USER)} >/dev/null 2>&1; then
  if command -v adduser >/dev/null 2>&1; then
    adduser -D -u ${GUEST_UID} -h ${sq(GUEST_HOME)} -s /bin/sh ${sq(GUEST_USER)} >/dev/null 2>&1
  elif command -v useradd >/dev/null 2>&1; then
    useradd -m -u ${GUEST_UID} -d ${sq(GUEST_HOME)} -s /bin/sh ${sq(GUEST_USER)} >/dev/null 2>&1
  fi
fi
if id -u ${sq(GUEST_USER)} >/dev/null 2>&1; then
  chown -R ${GUEST_UID}:${GUEST_GID} ${sq(GUEST_HOME)} 2>/dev/null || true
  # boat gives the sandbox user passwordless sudo; match it where sudo exists.
  if [ -d /etc/sudoers.d ]; then
    echo ${sq(`${GUEST_USER} ALL=(ALL) NOPASSWD:ALL`)} > /etc/sudoers.d/spaces-user 2>/dev/null || true
    chmod 0440 /etc/sudoers.d/spaces-user 2>/dev/null || true
  fi
fi
chmod 1777 /tmp 2>/dev/null || true
exit 0
`;

/**
 * Run a script as the sandbox user.
 *
 * `msb exec` has no uid flag, so the drop happens inside the guest. Arguments
 * are folded into the script (`set -- ...`) rather than forwarded, because
 * neither `setpriv` nor `su -c` has a reliable way to pass positionals.
 */
const AS_GUEST_USER = `
s=$1
if [ "$(id -u)" = 0 ] && id -u ${GUEST_USER} >/dev/null 2>&1; then
  # su is the portable primitive: busybox (Alpine) and util-linux (Debian) both
  # support -s/-c, and both set HOME/USER from passwd.
  if command -v su >/dev/null 2>&1; then
    exec su ${GUEST_USER} -s /bin/sh -c "$s"
  fi
  # Alpine ships a busybox setpriv that only handles capabilities; probe for the
  # util-linux one rather than trusting the name.
  if command -v setpriv >/dev/null 2>&1 && setpriv --reuid=0 true >/dev/null 2>&1; then
    exec setpriv --reuid=${GUEST_UID} --regid=${GUEST_GID} --clear-groups \
      env HOME=${GUEST_HOME} USER=${GUEST_USER} sh -c "$s"
  fi
fi
exec sh -c "$s"
`;
/**
 * Driver backed by [microsandbox](https://github.com/superradcompany/microsandbox)
 * (`msb`), which runs microVMs on libkrun.
 *
 * Lifecycle maps directly onto msb: `create` boots from an OCI image,
 * `stop`/`resume` are msb stop/start, and `fork` uses msb's copy-on-write
 * child sandboxes. File operations ride on `msb exec`, so they work identically
 * whether msb runs locally or over SSH.
 */
export class MicrosandboxDriver implements SandboxDriver {
  readonly kind = "microsandbox";
  readonly capabilities = { exec: true, files: true, persistence: true };

  private readonly host: string;
  private readonly msb: string;
  private readonly image: string;
  private readonly timeoutMs: number;

  constructor(options: MicrosandboxDriverOptions) {
    this.host = options.host;
    this.msb = options.msbPath ?? "~/.local/bin/msb";
    this.image = options.image ?? "alpine";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /** Run an msb subcommand, returning stdout. Throws on non-zero exit. */
  private async msbRun(args: string[], timeoutMs = this.timeoutMs, stdin?: Uint8Array | string) {
    const options: { timeoutMs: number; stdin?: Uint8Array | string } = { timeoutMs };

    if (stdin !== undefined) options.stdin = stdin;

    const { stdout, stderr, code } = await runRemote(this.host, [this.msb, ...args], options);

    if (code !== 0) {
      const reason = (stderr.trim() || stdout.trim() || `exit ${code}`).split("\n").pop();
      throw new DriverFailure(`msb ${args[0]} failed: ${reason}`);
    }

    return stdout;
  }

  private async msbJson<T>(args: string[]): Promise<T> {
    const stdout = await this.msbRun([...args, "--format", "json"]);
    try {
      return JSON.parse(stdout) as T;
    } catch {
      throw new DriverFailure(`msb ${args[0]} returned non-JSON output`);
    }
  }

  private spec(type: CreateOptions["type"]) {
    const size = MACHINE_SIZES[type];
    return { cpus: String(size.vcpu), memory: `${size.memMib}M` };
  }

  /** Refs are `msb:<name>` / `snap:<group>:<name>`; the name is the sandbox id. */
  private nameOf(ref: string): string {
    return ref.startsWith("msb:") ? ref.slice(4) : ref;
  }

  /**
   * Run a POSIX shell snippet inside the guest, with `args` bound to `$1..$n`.
   * Everything file-related funnels through here so local and remote behave
   * identically and no host temp files are needed.
   */
  private async guest(
    ref: string,
    script: string,
    args: string[],
    options: {
      timeoutMs?: number;
      stdin?: Uint8Array | string;
      runAs?: "user" | "root";
    } = {},
  ) {
    const name = this.nameOf(ref);
    // Positionals are prelude, not argv: the privilege wrapper re-execs the
    // script and cannot carry them.
    const body = args.length ? `set -- ${args.map(sq).join(" ")}\n${script}` : script;
    const prefix = [this.msb, "exec", name, "--", "sh", "-c"];
    const argv =
      (options.runAs ?? "user") === "root"
        ? [...prefix, body]
        : [...prefix, AS_GUEST_USER, "spaces", body];
    const runOptions: { timeoutMs: number; stdin?: Uint8Array | string } = {
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    };

    if (options.stdin !== undefined) runOptions.stdin = options.stdin;

    return runRemote(this.host, argv, runOptions);
  }

  /* ------------------------------------------------------------ lifecycle */

  async create(o: CreateOptions): Promise<DriverHandle> {
    const { cpus, memory } = this.spec(o.type);
    await this.msbRun([
      "create",
      "-n",
      o.sandboxId,
      "-c",
      cpus,
      "-m",
      memory,
      ...this.networkArgs(),
      ...this.portArgs(o.ports ?? []),
      "--replace",
      "--quiet",
      this.image,
    ]);
    // Fresh OCI images ship no /home/user and no sandbox user. Boat treats the
    // directory as the work directory and runs everything as `user`, so both
    // have to exist before anything else touches the guest.
    await this.guest(`msb:${o.sandboxId}`, GUEST_INIT, [], { runAs: "root" }).catch(() => {});
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async resume(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    // msb keeps stopped sandboxes on disk; starting one restores its disk and
    // its configuration, so the network device and port mappings come back.
    await this.msbRun(["start", this.nameOf(o.fromRef)]);
    await this.guest(`msb:${o.sandboxId}`, GUEST_INIT, [], { runAs: "root" }).catch(() => {});
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async fork(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    // `msb fork` copies the parent's configuration, network device included.
    // The child still needs its own host ports, or two sandboxes would fight
    // over the same ones.
    await this.msbRun([
      "fork",
      this.nameOf(o.fromRef),
      "-n",
      o.sandboxId,
      ...this.portArgs(o.ports ?? []),
    ]);
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async stop(sandboxId: string): Promise<{ diskRef: string }> {
    await this.msbRun(["stop", sandboxId]);
    return { diskRef: `msb:${sandboxId}` };
  }

  async destroy(sandboxId: string): Promise<void> {
    const { code, stderr } = await runRemote(this.host, [this.msb, "rm", sandboxId, "--force"], {
      timeoutMs: this.timeoutMs,
    });

    if (code !== 0 && !/not found|no such/i.test(stderr)) {
      throw new DriverFailure(`msb rm failed: ${stderr.trim()}`);
    }
  }

  async snapshot(sandboxId: string, snapshotId: string) {
    // `msb snapshot create` occasionally fails while the guest is still
    // settling after boot. One retry turns that into a non-event; the second
    // failure is real and propagates.
    try {
      await this.msbRun(["snapshot", "create", "--sandbox", sandboxId, snapshotId]);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 750));
      await this.msbRun(["snapshot", "create", "--sandbox", sandboxId, snapshotId]);
    }
    const listed = await this.msbJson<MsbSnapshot[]>(["snapshot", "list"]);
    const match = listed.find((s) => s.group === sandboxId && s.name === snapshotId);
    return { ref: `snap:${sandboxId}:${snapshotId}`, sizeBytes: match?.size_bytes ?? 0 };
  }

  async destroySnapshot(ref: string): Promise<void> {
    const [, group, name] = ref.split(":");

    if (!group || !name) throw new DriverFailure(`malformed snapshot ref: ${ref}`);

    await this.msbRun(["snapshot", "rm", `${group}:${name}`]);
  }

  async isRunning(ref: string): Promise<boolean> {
    try {
      const status = await this.msbJson<{ status?: string }>(["status", this.nameOf(ref)]);
      return RUNNING_STATES.has(status.status ?? "");
    } catch {
      return false;
    }
  }

  /* ----------------------------------------------------------------- exec */

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    const name = this.nameOf(ref);
    const startedAt = new Date().toISOString();
    const started = Date.now();

    // msb has no cwd flag. Default to the sandbox work directory so relative
    // paths behave the same here as they do for the file endpoints.
    const script = `cd ${sq(request.cwd ?? GUEST_HOME)} && ${request.command}`;
    const args = request.args ?? [];
    const body = args.length ? `set -- ${args.map(sq).join(" ")}\n${script}` : script;
    const runAs = request.runAs ?? "user";
    const argv = [
      this.msb,
      "exec",
      name,
      "--timeout",
      `${request.timeoutSeconds}s`,
      "--no-stdin",
      "--",
      "sh",
      "-c",
    ];

    if (runAs === "root") argv.push(body);
    else argv.push(AS_GUEST_USER, "spaces", body);

    const { stdout, stderr, code } = await runRemote(this.host, argv, {
      timeoutMs: (request.timeoutSeconds + 60) * 1000,
    });

    const elapsed = Date.now() - started;
    return {
      exitCode: code,
      signal: null,
      stdout,
      stderr,
      timedOut: elapsed >= request.timeoutSeconds * 1000 && code !== 0,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  /**
   * Guest networking flags. Without these the guest boots with no network
   * device at all, which is why SSH, package installs and port publishing were
   * unreachable.
   */
  private networkArgs(): string[] {
    return networkArgsFor({
      profile: config.netProfile,
      rules: config.netRules,
      defaultEgress: config.netDefaultEgress,
      defaultIngress: config.netDefaultIngress,
      dns: config.netDns,
    });
  }

  /** `-p` arguments for create-time port mappings. */
  private portArgs(ports: PortMapping[]): string[] {
    return ports.flatMap((port) => ["-p", `${port.bind}:${port.hostPort}:${port.guestPort}`]);
  }

  /** IPv4 address of the guest, or null when it has no network device. */
  async guestIp(sandboxId: string): Promise<string | null> {
    try {
      const stdout = await this.fileGuest(
        `msb:${sandboxId}`,
        `ip -o -4 addr show eth0 2>/dev/null | awk '{print $4}' | cut -d/ -f1`,
        [],
      );
      const ip = stdout.trim().split("\n")[0]?.trim();
      return ip && /^\d+\.\d+\.\d+\.\d+$/.test(ip) ? ip : null;
    } catch {
      return null;
    }
  }

  /**
   * Publish a guest port on the host. `msb modify` adds the mapping to a running
   * sandbox, so a port can be exposed long after create.
   */
  async publishPort(
    sandboxId: string,
    mapping: { bind: string; hostPort: number; guestPort: number },
    mode: "restart" | "next-start" = "restart",
  ): Promise<void> {
    // msb refuses to change ports on a running microVM without saying how to
    // apply them: `--restart` applies now, `--next-start` waits for the boot.
    await this.msbRun([
      "modify",
      sandboxId,
      "-p",
      `${mapping.bind}:${mapping.hostPort}:${mapping.guestPort}`,
      mode === "restart" ? "--restart" : "--next-start",
    ]);
  }

  async unpublishPort(
    sandboxId: string,
    mapping: { hostPort: number; guestPort: number },
  ): Promise<void> {
    await this.msbRun([
      "modify",
      sandboxId,
      "--port-rm",
      `${mapping.hostPort}:${mapping.guestPort}`,
    ]).catch(() => {});
  }

  /** Power-cycle: the disk survives, which is what a microVM restart gives us. */
  async restart(sandboxId: string): Promise<void> {
    await this.msbRun(["restart", sandboxId]);
  }

  /**
   * Boot a throwaway sandbox from a snapshot so its files can be read.
   *
   * `msb restore` takes a `group:member` selector and needs no checkpoint state
   * for a disk snapshot (passing `--disk-only` is actually rejected for those).
   * Our refs are `snap:<group>:<member>`, so the selector is the ref minus the
   * scheme.
   */
  async restoreTemporary(fromRef: string, name: string): Promise<{ ref: string }> {
    const selector = fromRef.startsWith("snap:") ? fromRef.slice(5) : fromRef;
    await this.msbRun(["restore", selector, "--name", name], this.timeoutMs);
    return { ref: `msb:${name}` };
  }

  async removeTemporary(ref: string): Promise<void> {
    await this.msbRun(["rm", this.nameOf(ref), "--force"]).catch(() => {});
  }

  /**
   * Flat listing of a directory inside a restored snapshot. Paths come back
   * relative to `root`; `limit` caps the walk so a huge tree cannot hang it.
   */
  async listSnapshotTree(
    ref: string,
    root: string,
    limit: number,
  ): Promise<{ path: string; kind: string; size?: number }[]> {
    const script = `
cd "$1" 2>/dev/null || exit 0
find . -mindepth 1 2>/dev/null | head -n "$2" | while IFS= read -r p; do
  p=\${p#./}
  if [ -d "$p" ]; then
    printf 'dir\t%s\n' "$p"
  elif [ -L "$p" ]; then
    printf 'symlink\t%s\n' "$p"
  else
    printf 'file\t%s\t%s\n' "$p" "$(wc -c < "$p" 2>/dev/null || echo 0)"
  fi
done`;
    const stdout = await this.fileGuest(ref, script, [root, String(limit)]);
    const entries: { path: string; kind: string; size?: number }[] = [];

    for (const line of stdout.split("\n")) {
      const [kind, path, size] = line.split("\t");

      if (!line || !path) continue;

      entries.push(
        kind === "file" ? { path, kind, size: Number(size ?? 0) } : { path, kind: kind ?? "file" },
      );
    }

    return entries;
  }

  /** File bytes, or the subtree as a tar, for one path inside a snapshot. */
  async readSnapshotEntry(
    ref: string,
    path: string,
  ): Promise<{ kind: "file" | "dir"; bytes: Uint8Array }> {
    const kind = parseKeyValues(
      await this.fileGuest(
        ref,
        `t="$1"
[ -e "$t" ] || { echo "ENOENT: $t" >&2; exit 4; }
if [ -d "$t" ]; then echo "KIND=dir"; else echo "KIND=file"; fi`,
        [path],
      ),
    ).KIND;

    if (kind === "dir") {
      const stdout = await this.fileGuest(
        ref,
        `cd "$1" || exit 4; tar -cf - . 2>/dev/null | base64`,
        [path],
      );
      return { kind: "dir", bytes: decodeBase64(stdout) };
    }

    const stdout = await this.fileGuest(ref, `base64 < "$1"`, [path]);
    return { kind: "file", bytes: decodeBase64(stdout) };
  }

  /* ------------------------------------------------------------- processes */

  /** Root of the guest-side process runtime. Under /tmp so it is always writable. */
  private static readonly PROC_DIR = "/tmp/.spaces/proc";

  /**
   * Start a background process in the guest.
   *
   * A plain `cmd &` does not work: `msb exec` waits for its children (measured
   * ~5 s for a 5 s child), so the process is launched through `setsid` with all
   * three descriptors detached. That returns in tens of milliseconds and lets
   * the child outlive the exec.
   */
  async startProcess(
    ref: string,
    options: { processId: string; command: string; cwd: string; timeoutSeconds: number },
  ): Promise<{ pid: number; logPath: string; errLogPath: string }> {
    const dir = `${MicrosandboxDriver.PROC_DIR}/${options.processId}`;
    const runner = [
      "#!/bin/sh",
      `cd ${sq(options.cwd)} || exit 126`,
      `timeout ${options.timeoutSeconds} /bin/sh -c ${sq(options.command)} >${sq(`${dir}/out`)} 2>${sq(`${dir}/err`)}`,
      `echo $? > ${sq(`${dir}/exit`)}`,
      "",
    ].join("\n");

    const script = `
d=${MicrosandboxDriver.PROC_DIR}/$1
mkdir -p "$d" || exit 9
rm -f "$d/exit"
: > "$d/out"
: > "$d/err"
base64 -d > "$d/run.sh" || exit 9
chmod 755 "$d/run.sh"
setsid "$d/run.sh" </dev/null >/dev/null 2>&1 &
echo $! > "$d/pid"
cat "$d/pid"`;

    const stdout = await this.fileGuest(
      ref,
      script,
      [options.processId],
      encodeBase64(new TextEncoder().encode(runner)),
    );
    const pid = Number(stdout.trim());

    if (!Number.isFinite(pid) || pid <= 0) {
      throw new DriverFailure(`guest returned no pid for ${options.processId}`);
    }

    return { pid, logPath: `${dir}/out`, errLogPath: `${dir}/err` };
  }

  async processState(
    ref: string,
    processId: string,
  ): Promise<{ running: boolean; exitCode: number | null; pid: number | null; known: boolean }> {
    const script = `
d=${MicrosandboxDriver.PROC_DIR}/$1
if [ ! -d "$d" ]; then
  echo "KNOWN=0"; exit 0
fi
echo "KNOWN=1"
echo "PID=$(cat "$d/pid" 2>/dev/null)"
if [ -f "$d/exit" ]; then
  echo "STATE=exited"
  echo "CODE=$(cat "$d/exit" 2>/dev/null)"
  exit 0
fi
p=$(cat "$d/pid" 2>/dev/null)
if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
  echo "STATE=running"; exit 0
fi
# No exit file and no live pid: the process was lost (e.g. VM restart).
echo "STATE=lost"`;

    const out = parseKeyValues(await this.fileGuest(ref, script, [processId]));
    const code = out.CODE && out.CODE !== "" ? Number(out.CODE) : null;
    return {
      running: out.STATE === "running",
      exitCode: code,
      pid: out.PID ? Number(out.PID) : null,
      known: out.KNOWN === "1",
    };
  }

  /**
   * SIGTERM to the process group, SIGKILL whatever is left after the grace
   * period. Matching boat: the whole group, 5 s of grace.
   */
  async killProcess(
    ref: string,
    processId: string,
    graceSeconds = 5,
  ): Promise<{ signaled: boolean }> {
    const script = `
d=${MicrosandboxDriver.PROC_DIR}/$1
p=$(cat "$d/pid" 2>/dev/null)
sig=0
if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
  kill -TERM -"$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null
  i=0
  limit=$(( $2 * 10 ))
  while [ $i -lt $limit ] && kill -0 "$p" 2>/dev/null; do sleep 0.1; i=$((i+1)); done
  if kill -0 "$p" 2>/dev/null; then
    kill -KILL -"$p" 2>/dev/null || kill -KILL "$p" 2>/dev/null
  fi
  sig=1
fi
echo "SIGNALED=$sig"`;

    const out = parseKeyValues(
      await this.fileGuest(ref, script, [processId, String(graceSeconds)]),
    );
    return { signaled: out.SIGNALED === "1" };
  }

  /**
   * Read stdout/stderr as raw bytes, optionally from a byte offset.
   * Offsets let a polling client ask only for what is new.
   */
  async readProcessOutput(
    ref: string,
    processId: string,
    offsets?: { stdoutOffset?: number; stderrOffset?: number },
  ): Promise<{
    stdout: Uint8Array;
    stderr: Uint8Array;
    stdoutNextOffset: number;
    stderrNextOffset: number;
  }> {
    const stdoutOffset = offsets?.stdoutOffset ?? 0;
    const stderrOffset = offsets?.stderrOffset ?? 0;

    const readOne = async (file: "out" | "err", offset: number) => {
      const script = `
d=${MicrosandboxDriver.PROC_DIR}/$1
[ -d "$d" ] || { echo "ENOENT" >&2; exit 4; }
f="$d/$2"
[ -f "$f" ] || exit 0
if [ "$3" -gt 0 ]; then
  tail -c +$(( $3 + 1 )) "$f" 2>/dev/null | base64
else
  base64 < "$f" 2>/dev/null
fi`;
      const raw = await this.fileGuest(ref, script, [processId, file, String(offset)]);
      return decodeBase64(raw);
    };

    // Independent reads, so they overlap instead of costing two round trips.
    const [stdout, stderr] = await Promise.all([
      readOne("out", stdoutOffset),
      readOne("err", stderrOffset),
    ]);

    return {
      stdout,
      stderr,
      stdoutNextOffset: stdoutOffset + stdout.byteLength,
      stderrNextOffset: stderrOffset + stderr.byteLength,
    };
  }

  async listProcesses(ref: string): Promise<
    {
      pid: number;
      parentPid: number;
      user: string;
      memoryMB: number;
      command: string;
      commandId: string | null;
    }[]
  > {
    // Two separate calls joined here: mixing a process table and a marker line in
    // one script makes the parse depend on marker framing, which is brittle.
    const [table, trackedRaw] = await Promise.all([
      this.fileGuest(
        ref,
        `ps -o pid,ppid,user,rss,args 2>/dev/null | tail -n +2 | while read -r pid ppid user rss args; do
  printf '%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$user" "$rss" "$args"
done`,
        [],
      ),
      this.fileGuest(
        ref,
        `for f in ${MicrosandboxDriver.PROC_DIR}/*/pid; do
  [ -f "$f" ] || continue
  printf '%s\t%s\n' "$(cat "$f" 2>/dev/null)" "$(basename "$(dirname "$f")")"
done`,
        [],
      ),
    ]);

    const tracked = new Map<number, string>();
    for (const line of trackedRaw.split("\n")) {
      const [pid, id] = line.split("\t");

      if (pid && id) tracked.set(Number(pid.trim()), id.trim());
    }

    const processes: {
      pid: number;
      parentPid: number;
      user: string;
      memoryMB: number;
      command: string;
      commandId: string | null;
    }[] = [];

    for (const raw of table.split("\n")) {
      const line = raw.trimEnd();

      if (!line.includes("\t")) continue;

      const [pid, ppid, user, rss, ...rest] = line.split("\t");
      const pidNum = Number(pid);

      if (!(pidNum > 0)) continue;

      processes.push({
        pid: pidNum,
        parentPid: Number(ppid ?? 0),
        user: user ?? "",
        memoryMB: Math.round(Number(rss ?? 0) / 1024),
        command: (rest.join("\t") || "").slice(0, 1000),
        commandId: tracked.get(pidNum) ?? null,
      });
    }

    return processes;
  }

  /* ---------------------------------------------------------------- files */

  /**
   * Canonicalise a path *inside the guest*, resolving symlinks for every part
   * that exists. The host-side check is lexical, so without this a symlink in
   * the sandbox could point outside the allowed trees.
   */
  private static readonly CANON = [
    "canon() {",
    '  c="${1%/}"',
    '  [ -z "$c" ] && c=/',
    '  rest=""',
    '  probe="$c"',
    '  while [ "$probe" != "/" ] && [ ! -e "$probe" ] && [ ! -L "$probe" ]; do',
    '    rest="/${probe##*/}$rest"',
    '    probe=$(dirname "$probe")',
    "  done",
    '  base=$(readlink -f "$probe" 2>/dev/null) || base="$probe"',
    '  printf \'%s%s\' "${base%/}" "$rest"',
    "}",
  ].join("\n");

  /**
   * Build a guest script whose path arguments are canonicalised and root-checked.
   *
   * `resolveLeaf: false` canonicalises only the parent and re-attaches the last
   * component, so symlinks are operated on as links rather than followed. Boat
   * requires that for `info`, `delete` and `move` ("a symlink is deleted itself,
   * never its target").
   */
  private guarded(
    body: string,
    guards: { arg: string; as: string; resolveLeaf?: boolean }[],
  ): string {
    const checks = guards
      .map((g, i) => {
        if (g.resolveLeaf === false) {
          return `r${i}=$(canon "$(dirname "${g.arg}")")
case "$r${i}" in
  /home/user|/home/user/*|/tmp|/tmp/*) ;;
  *) echo "EBADPATH:$r${i}" >&2; exit 8 ;;
esac
${g.as}="$r${i}/$(basename "${g.arg}")"`;
        }

        return `r${i}=$(canon "${g.arg}")
case "$r${i}" in
  /home/user|/home/user/*|/tmp|/tmp/*) ;;
  *) echo "EBADPATH:$r${i}" >&2; exit 8 ;;
esac
${g.as}="$r${i}"`;
      })
      .join("\n");
    return `${MicrosandboxDriver.CANON}
${checks}
${body}`;
  }

  private async fileGuest(
    ref: string,
    script: string,
    args: string[],
    stdin?: Uint8Array | string,
  ): Promise<string> {
    const { stdout, stderr, code } = await this.guest(
      ref,
      script,
      args,
      stdin === undefined ? {} : { stdin },
    );

    if (code !== 0) {
      const reason = (stderr.trim() || `exit ${code}`).split("\n").pop();
      throw new DriverFailure(`guest operation failed: ${reason}`);
    }

    return stdout;
  }

  async readFile(ref: string, path: string): Promise<Uint8Array> {
    const script = this.guarded(
      '[ -e "$p" ] || [ -L "$p" ] || { echo ENOENT >&2; exit 4; }\n[ -f "$p" ] || { echo EISDIR >&2; exit 7; }\nbase64 < "$p"',
      [{ arg: "$1", as: "p" }],
    );
    return decodeBase64(await this.fileGuest(ref, script, [path]));
  }

  async writeFile(ref: string, path: string, bytes: Uint8Array): Promise<void> {
    const script = this.guarded('mkdir -p "$(dirname "$p")" && base64 -d > "$p"', [
      { arg: "$1", as: "p" },
    ]);
    await this.fileGuest(ref, script, [path], encodeBase64(bytes));
  }

  async listFiles(ref: string, path: string): Promise<FileEntry[]> {
    // NUL-framed so filenames containing tabs or newlines survive intact.
    const script = this.guarded(
      `[ -d "$p" ] || { echo ENOTDIR >&2; exit 3; }
find "$p" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | while IFS= read -r -d "" e; do
  n=\${e##*/}
  if [ -L "$e" ]; then k=1
  elif [ -d "$e" ]; then k=2
  else k=0; fi
  s=$(stat -c %s "$e" 2>/dev/null || echo 0)
  m=$(stat -c %a "$e" 2>/dev/null || echo 0)
  t=$(stat -c %Y "$e" 2>/dev/null || echo 0)
  printf '%s\\0%s\\0%s\\0%s\\0%s\\0' "$n" "$k" "$s" "$m" "$t"
done`,
      [{ arg: "$1", as: "p" }],
    );
    const stdout = await this.fileGuest(ref, script, [path]);
    const fields = stdout.split("\0");
    const entries: FileEntry[] = [];
    for (let i = 0; i + 4 < fields.length; i += 5) {
      entries.push({
        name: fields[i]!,
        path: joinPath(path, fields[i]!),
        isSymlink: fields[i + 1] === "1",
        isDir: fields[i + 1] === "2",
        size: Number(fields[i + 2] ?? 0),
        mode: padMode(fields[i + 3] ?? "0"),
        modifiedAt: new Date(Number(fields[i + 4] ?? 0) * 1000).toISOString(),
      });
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async fileInfo(ref: string, path: string): Promise<FileEntry> {
    const script = this.guarded(
      `[ -e "$p" ] || [ -L "$p" ] || { echo ENOENT >&2; exit 4; }
if [ -L "$p" ]; then k=1
elif [ -d "$p" ]; then k=2
else k=0; fi
s=$(stat -c %s "$p" 2>/dev/null || echo 0)
m=$(stat -c %a "$p" 2>/dev/null || echo 0)
t=$(stat -c %Y "$p" 2>/dev/null || echo 0)
printf '%s\\0%s\\0%s\\0%s\\0' "$k" "$s" "$m" "$t"`,
      [{ arg: "$1", as: "p", resolveLeaf: false }],
    );
    const fields = (await this.fileGuest(ref, script, [path])).split("\0");
    return {
      name: path.split("/").filter(Boolean).pop() ?? "/",
      path,
      isSymlink: fields[0] === "1",
      isDir: fields[0] === "2",
      size: Number(fields[1] ?? 0),
      mode: padMode(fields[2] ?? "0"),
      modifiedAt: new Date(Number(fields[3] ?? 0) * 1000).toISOString(),
    };
  }

  async makeFolder(ref: string, path: string, mode?: string): Promise<void> {
    const body = mode ? 'mkdir -p "$p" && chmod "$2" "$p"' : 'mkdir -p "$p"';
    await this.fileGuest(
      ref,
      this.guarded(body, [{ arg: "$1", as: "p" }]),
      mode ? [path, mode] : [path],
    );
  }

  async setPermissions(ref: string, path: string, mode: string): Promise<void> {
    // Operate on the path as given (parent guarded); chmod semantics follow symlinks,
    // which matches POSIX and boat's "ownership does not change" note.
    const script = this.guarded('chmod "$2" "$p" || { echo "EPERM" >&2; exit 9; }', [
      { arg: "$1", as: "p", resolveLeaf: false },
    ]);
    await this.fileGuest(ref, script, [path, mode]);
  }

  async movePath(
    ref: string,
    source: string,
    destination: string,
    overwrite: boolean,
  ): Promise<void> {
    const script = this.guarded(
      `[ -e "$src" ] || [ -L "$src" ] || { echo ENOENT >&2; exit 4; }
if [ -e "$dst" ] && [ "$3" != "1" ]; then echo EEXIST >&2; exit 5; fi
mkdir -p "$(dirname "$dst")"
mv "$src" "$dst"`,
      [
        { arg: "$1", as: "src", resolveLeaf: false },
        { arg: "$2", as: "dst" },
      ],
    );
    await this.fileGuest(ref, script, [source, destination, overwrite ? "1" : "0"]);
  }

  async removePath(ref: string, path: string, recursive: boolean): Promise<void> {
    const script = this.guarded(
      `case "$p" in /home/user|/tmp) echo EPROTECTED >&2; exit 6 ;; esac
[ -e "$p" ] || [ -L "$p" ] || { echo ENOENT >&2; exit 4; }
if [ -d "$p" ] && [ ! -L "$p" ] && [ "$2" != "1" ]; then echo EISDIR >&2; exit 7; fi
rm -rf -- "$p"`,
      [{ arg: "$1", as: "p", resolveLeaf: false }],
    );
    await this.fileGuest(ref, script, [path, recursive ? "1" : "0"]);
  }

  async searchFiles(ref: string, path: string, pattern: string): Promise<string[]> {
    const script = this.guarded(
      '[ -d "$p" ] || { echo ENOTDIR >&2; exit 3; }\nfind "$p" -name "$2" -print 2>/dev/null',
      [{ arg: "$1", as: "p" }],
    );
    const stdout = await this.fileGuest(ref, script, [path, pattern]);
    return stdout.split("\n").filter(Boolean);
  }

  async findInFiles(
    ref: string,
    path: string,
    pattern: string,
    options: { ignoreCase: boolean; maxResults: number },
  ): Promise<{ matches: FileMatch[]; truncated: boolean }> {
    // grep -F keeps the pattern literal; boat treats it as plain text.
    const flags = options.ignoreCase ? "-rniF" : "-rnF";
    const script = this.guarded(
      `[ -d "$p" ] || { echo ENOTDIR >&2; exit 3; }
grep ${flags} -e "$2" "$p" 2>/dev/null || true`,
      [{ arg: "$1", as: "p" }],
    );
    const stdout = await this.fileGuest(ref, script, [path, pattern]);

    const matches: FileMatch[] = [];
    let truncated = false;
    for (const line of stdout.split("\n")) {
      if (!line) continue;

      const first = line.indexOf(":");
      const second = line.indexOf(":", first + 1);

      if (first < 0 || second < 0) continue;

      if (matches.length >= options.maxResults) {
        truncated = true;
        break;
      }

      matches.push({
        file: line.slice(0, first),
        line: Number(line.slice(first + 1, second)) || 0,
        content: line.slice(second + 1).slice(0, 500),
      });
    }
    return { matches, truncated };
  }
}

/** Shape of one entry from `msb snapshot list --format json`. */
interface MsbSnapshot {
  group?: string;
  name?: string;
  size_bytes?: number | null;
  scope?: string;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** stat reports "644"; boat reports "0644". */
function padMode(mode: string): string {
  const digits = mode.replace(/[^0-7]/g, "").slice(-4);
  return digits.padStart(4, "0");
}

/** Quote a path for the guest shell. */
/**
 * Map the documented networking settings onto msb flags.
 *
 * Pure and exported so the mapping can be tested without a hypervisor: `public`
 * is a *profile* (public addresses only, private denied), `all` is a terminal
 * policy, and `none` means no network device at all. Explicit rules are passed
 * through in order, because msb gives them precedence over the profile.
 */
export function networkArgsFor(o: {
  profile: string;
  rules: string[];
  defaultEgress: string;
  defaultIngress: string;
  dns: string;
}): string[] {
  const profile = o.profile.trim();

  if (!profile || profile === "none") return ["--no-net"];

  const args = ["--net", profile];
  for (const rule of o.rules) args.push("--net-rule", rule);

  if (o.defaultEgress) args.push("--net-default-egress", o.defaultEgress);

  if (o.defaultIngress) args.push("--net-default-ingress", o.defaultIngress);

  if (o.dns) args.push("--dns-nameserver", o.dns);

  return args;
}

function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function decodeBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text.replace(/\s+/g, ""), "base64"));
}
