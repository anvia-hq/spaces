/**
 * Process plumbing. `msb` can run on this machine or on a remote hypervisor
 * host, so every call goes through here and the caller never cares which.
 */

export interface RemoteResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Host values that mean "run the command here". */
const LOCAL_HOSTS = new Set(["", "local", "localhost", "127.0.0.1", "::1"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim());
}

/** POSIX single-quote escaping. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote one argument for the remote shell, keeping `~` expandable.
 *
 * Plain shell-quoting would turn `~/.local/bin/msb` into a literal path that
 * never expands, so the default SPACES_MSB failed on every remote host. Only
 * the tilde is left for the remote shell to interpret; the rest stays quoted.
 */
export function remoteQuote(arg: string): string {
  if (arg === "~") return '"$HOME"';

  if (arg.startsWith("~/")) return `"$HOME"${shellQuote(arg.slice(1))}`;

  return shellQuote(arg);
}

/**
 * Runs `argv` on `host`. For a local host it spawns directly; otherwise it goes
 * over SSH, quoting each argument so it survives the remote shell intact.
 *
 * Connection multiplexing keeps per-call latency low after the first hop.
 */
export async function runRemote(
  host: string,
  argv: string[],
  options: { timeoutMs?: number; stdin?: Uint8Array | string } = {},
): Promise<RemoteResult> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const local = isLocalHost(host);

  const cmd = local
    ? argv.map(expandHome)
    : [
        "ssh",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=10",
        "-o",
        "ControlMaster=auto",
        "-o",
        "ControlPath=/tmp/spaces-ssh-%r@%h:%p",
        "-o",
        "ControlPersist=120",
        host,
        ...argv.map(remoteQuote),
      ];

  const proc = Bun.spawn({
    cmd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: options.stdin === undefined ? "ignore" : "pipe",
  });

  const stdin = options.stdin === undefined ? null : proc.stdin;

  if (stdin && options.stdin !== undefined) {
    // Write then close: several guest commands read until EOF.
    stdin.write(options.stdin);
    await stdin.end();
  }

  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { stdout, stderr, code };
}

/** `~` is expanded by the remote shell over SSH, but not by local spawn. */
function expandHome(arg: string): string {
  const home = process.env.HOME ?? "";

  if (arg === "~") return home;

  if (arg.startsWith("~/")) return `${home}${arg.slice(1)}`;

  return arg;
}
/** Parse `KEY=VALUE` lines. Helpers emit this because it is cheap in shell. */
export function parseKeyValues(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");

    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}
