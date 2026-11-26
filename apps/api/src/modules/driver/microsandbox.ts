import { SANDBOX_WORKDIR } from "@spaces/shared/files";
import {
  classifyNetworkEntry,
  isPrivateIpOrCidr,
  type NetworkPolicy,
} from "@spaces/shared/sandbox";
import { config } from "../../config.ts";
import type { FileEntry, FileMatch } from "@spaces/shared/files";
import type {
  CreateOptions,
  DriverHandle,
  ExecRequest,
  ExecResult,
  PortMapping,
  ProxyRequest,
  ProxyResponse,
  SandboxDriver,
} from "./types.ts";
import { DriverFailure } from "../../errors.ts";
import { isLocalHost, parseKeyValues, runRemote } from "./ssh.ts";
import { closeTunnel, tunnelFor } from "./tunnel.ts";

export interface MicrosandboxDriverOptions {
  host: string;
  msbPath?: string;
  image?: string;
  timeoutMs?: number;
}

const RUNNING_STATES = new Set(["Running", "Started", "Ready"]);

const GUEST_USER = "user";
const GUEST_UID = 1000;
const GUEST_GID = 1000;
const GUEST_HOME = SANDBOX_WORKDIR;

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
export class MicrosandboxDriver implements SandboxDriver {
  readonly kind = "microsandbox";
  readonly capabilities = { exec: true, files: true, persistence: true, networkPolicy: true };

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

  private spec(size: CreateOptions["size"]) {
    return { cpus: String(size.vcpu), memory: `${size.memMib}M` };
  }

  private nameOf(ref: string): string {
    return ref.startsWith("msb:") ? ref.slice(4) : ref;
  }

  private snapshotSelector(ref: string): string {
    return ref.startsWith("snap:") ? ref.slice(5) : ref;
  }

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

  async create(o: CreateOptions): Promise<DriverHandle> {
    const { cpus, memory } = this.spec(o.size);
    const rootDisk = rootDiskArgsFor(o.size);
    await this.msbRun([
      "create",
      "-n",
      o.sandboxId,
      "-c",
      cpus,
      "-m",
      memory,
      ...rootDisk,
      ...this.networkArgs(o.network),
      ...this.portArgs(o.ports ?? []),
      "--replace",
      "--quiet",
      this.image,
    ]);
    await this.guest(`msb:${o.sandboxId}`, GUEST_INIT, [], { runAs: "root" }).catch(() => {});
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async resume(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    await this.msbRun(["start", this.nameOf(o.fromRef)]);
    await this.guest(`msb:${o.sandboxId}`, GUEST_INIT, [], { runAs: "root" }).catch(() => {});
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async fork(o: Omit<CreateOptions, "network"> & { fromRef: string }): Promise<DriverHandle> {
    await this.msbRun([
      "fork",
      this.nameOf(o.fromRef),
      "-n",
      o.sandboxId,
      ...this.portArgs(o.ports ?? []),
    ]);
    return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
  }

  async restore(o: CreateOptions & { fromRef: string }): Promise<DriverHandle> {
    try {
      const { cpus, memory } = this.spec(o.size);
      await this.msbRun(
        [
          "restore",
          this.snapshotSelector(o.fromRef),
          "--name",
          o.sandboxId,
          "-c",
          cpus,
          "-m",
          memory,
          ...this.restoreNetworkArgs(o.network),
          ...this.portArgs(o.ports ?? []),
        ],
        this.timeoutMs,
      );
      await this.guest(`msb:${o.sandboxId}`, GUEST_INIT, [], { runAs: "root" }).catch(() => {});
      return { ref: `msb:${o.sandboxId}`, url: null, ip: await this.guestIp(o.sandboxId) };
    } catch (error) {
      await this.destroy(o.sandboxId).catch(() => {});
      throw error;
    }
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

  async exec(ref: string, request: ExecRequest): Promise<ExecResult> {
    const name = this.nameOf(ref);
    const startedAt = new Date().toISOString();
    const started = Date.now();

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

  private networkArgs(policy?: NetworkPolicy): string[] {
    return networkArgsFor({
      profile: config.netProfile,
      rules: config.netRules,
      defaultEgress: config.netDefaultEgress,
      defaultIngress: config.netDefaultIngress,
      dns: config.netDns,
      policy,
    });
  }

  private restoreNetworkArgs(policy?: NetworkPolicy): string[] {
    return restoreNetworkArgsFor({
      profile: config.netProfile,
      rules: config.netRules,
      defaultEgress: config.netDefaultEgress,
      policy,
    });
  }

  private portArgs(ports: PortMapping[]): string[] {
    return ports.flatMap((port) => ["-p", `${port.bind}:${port.hostPort}:${port.guestPort}`]);
  }

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

  async publishPort(
    sandboxId: string,
    mapping: { bind: string; hostPort: number; guestPort: number },
    mode: "restart" | "next-start" = "restart",
  ): Promise<void> {
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

  async listeningPorts(): Promise<number[] | null> {
    if (isLocalHost(this.host)) return null;

    try {
      const { stdout, code } = await runRemote(this.host, [
        "sh",
        "-c",
        "ss -H -tln 2>/dev/null | awk '{print $4}' || netstat -tln 2>/dev/null | awk '{print $4}'",
      ]);

      if (code !== 0 && !stdout.trim()) return null;

      const ports = new Set<number>();
      for (const token of stdout.split(/\s+/)) {
        const match = /:(\d+)$/.exec(token.trim());

        if (match) ports.add(Number(match[1]));
      }

      return ports.size === 0 ? null : [...ports];
    } catch {
      return null;
    }
  }

  async isPortFree(port: number, bind: string): Promise<boolean> {
    try {
      const server = Bun.listen({ hostname: bind, port, socket: { data() {} } });
      server.stop(true);
      return true;
    } catch {
      return false;
    }
  }

  async forgetPort(hostPort: number): Promise<void> {
    closeTunnel(this.host, hostPort);
  }

  async proxyHttp(request: ProxyRequest): Promise<ProxyResponse> {
    let dialPort: number;
    try {
      dialPort = await tunnelFor(this.host, request.hostPort);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DriverFailure(`could not reach the published port on ${this.host} (${message})`);
    }

    let upstream: Response;
    try {
      upstream = await fetch(`http://127.0.0.1:${dialPort}${request.path}`, {
        method: request.method,
        headers: request.headers,
        body: request.body ? new Uint8Array(request.body) : undefined,
        redirect: "manual",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new DriverFailure(`nothing answered on the published port (${message})`);
    }

    return {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: [...upstream.headers.entries()],
      body: upstream.body,
    };
  }

  async restart(sandboxId: string): Promise<void> {
    await this.msbRun(["restart", sandboxId]);
  }

  async restoreTemporary(fromRef: string, name: string): Promise<{ ref: string }> {
    await this.msbRun(["restore", this.snapshotSelector(fromRef), "--name", name], this.timeoutMs);
    return { ref: `msb:${name}` };
  }

  async removeTemporary(ref: string): Promise<void> {
    await this.msbRun(["rm", this.nameOf(ref), "--force"]).catch(() => {});
  }

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

  private static readonly PROC_DIR = "/tmp/.spaces/proc";

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

interface MsbSnapshot {
  group?: string;
  name?: string;
  size_bytes?: number | null;
  scope?: string;
}

function joinPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

function padMode(mode: string): string {
  const digits = mode.replace(/[^0-7]/g, "").slice(-4);
  return digits.padStart(4, "0");
}

export function rootDiskArgsFor(size: CreateOptions["size"]) {
  return ["--root-disk", `${size.diskGb}G`];
}

function allowRulesFor(entries: string[]): { rules: string[]; needsDns: boolean } {
  const rules: string[] = [];
  let needsDns = false;

  for (const raw of entries) {
    const entry = raw.trim().toLowerCase();
    const kind = classifyNetworkEntry(entry);

    if (kind === "domain") {
      needsDns = true;
      rules.push(`allow@${entry}:tcp:443`, `allow@${entry}:tcp:80`);
    } else if (kind === "ip") {
      if (isPrivateIpOrCidr(entry)) {
        throw new DriverFailure(`private or reserved IP/CIDR '${entry}' is not allowed`);
      }

      const target = entry.includes(":") ? `[${entry}]` : entry;
      rules.push(`allow@${target}`);
    } else {
      throw new DriverFailure(`invalid network allow entry '${entry}'`);
    }
  }

  return { rules, needsDns };
}

export function restoreNetworkArgsFor(o: {
  profile: string;
  rules: string[];
  defaultEgress: string;
  policy?: NetworkPolicy;
}): string[] {
  if (o.policy && o.policy.mode !== "default") {
    if (o.policy.mode === "deny") return ["--no-net"];

    if (o.policy.mode === "open") {
      return [
        "--net-default",
        "deny",
        "--net-rule",
        "allow:ingress@private",
        "--net-rule",
        "allow:ingress@public",
        "--net-rule",
        "allow@public",
        "--net-rule",
        "allow@dns",
      ];
    }

    const { rules, needsDns } = allowRulesFor(o.policy.allow);
    const args = [
      "--net-default",
      "deny",
      "--net-rule",
      "allow:ingress@private",
      "--net-rule",
      "allow:ingress@public",
    ];

    if (needsDns) args.push("--net-rule", "allow@dns");

    for (const rule of rules) args.push("--net-rule", rule);

    return args;
  }

  const profile = o.profile.trim();

  if (!profile || profile === "none") return ["--no-net"];

  if (profile === "all") {
    const args = ["--net-default", o.defaultEgress === "deny" ? "deny" : "allow"];
    for (const rule of o.rules) args.push("--net-rule", rule);
    return args;
  }

  const args = [
    "--net-default",
    "deny",
    "--net-rule",
    "allow:ingress@private",
    "--net-rule",
    "allow:ingress@public",
    "--net-rule",
    "allow@public",
    "--net-rule",
    "allow@dns",
  ];
  for (const rule of o.rules) args.push("--net-rule", rule);
  return args;
}

export function networkArgsFor(o: {
  profile: string;
  rules: string[];
  defaultEgress: string;
  defaultIngress: string;
  dns: string;
  policy?: NetworkPolicy;
}): string[] {
  if (o.policy && o.policy.mode !== "default") {
    if (o.policy.mode === "deny") return ["--no-net"];

    if (o.policy.mode === "open") {
      const args = ["--net", "public"];

      if (o.dns) args.push("--dns-nameserver", o.dns);

      return args;
    }

    const { rules, needsDns } = allowRulesFor(o.policy.allow);
    const args = ["--net-default-egress", "deny", "--net-default-ingress", "allow"];

    if (needsDns) {
      args.push("--net-rule", "allow@dns");

      if (o.dns) args.push("--dns-nameserver", o.dns);
    }

    for (const rule of rules) args.push("--net-rule", rule);

    return args;
  }

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
