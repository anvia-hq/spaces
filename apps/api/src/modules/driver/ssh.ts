export interface RemoteResult {
  stdout: string;
  stderr: string;
  code: number;
}

const LOCAL_HOSTS = new Set(["", "local", "localhost", "127.0.0.1", "::1"]);

export function isLocalHost(host: string): boolean {
  return LOCAL_HOSTS.has(host.trim());
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function remoteQuote(arg: string): string {
  if (arg === "~") return '"$HOME"';

  if (arg.startsWith("~/")) return `"$HOME"${shellQuote(arg.slice(1))}`;

  return shellQuote(arg);
}

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

function expandHome(arg: string): string {
  const home = process.env.HOME ?? "";

  if (arg === "~") return home;

  if (arg.startsWith("~/")) return `${home}${arg.slice(1)}`;

  return arg;
}
export function parseKeyValues(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf("=");

    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}
