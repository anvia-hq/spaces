import { isLocalHost } from "./ssh.ts";

interface Tunnel {
  localPort: number;
  process: ReturnType<typeof Bun.spawn>;
}

const tunnels = new Map<string, Tunnel>();

function key(host: string, remotePort: number): string {
  return `${host}:${remotePort}`;
}

function freeLocalPort(): number {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  const port = server.port;
  server.stop(true);
  return port;
}

async function waitForPort(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(400) });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!/ECONNREFUSED|Unable to connect|fetch failed/i.test(message)) return true;
    }
    await Bun.sleep(120);
  }
  return false;
}

export async function tunnelFor(host: string, remotePort: number): Promise<number> {
  if (isLocalHost(host)) return remotePort;

  const id = key(host, remotePort);
  const existing = tunnels.get(id);

  if (existing) return existing.localPort;

  const localPort = freeLocalPort();
  const proc = Bun.spawn({
    cmd: [
      "ssh",
      "-N",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ExitOnForwardFailure=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ControlMaster=auto",
      "-o",
      "ControlPath=/tmp/spaces-ssh-%r@%h:%p",
      "-o",
      "ControlPersist=120",
      "-L",
      `127.0.0.1:${localPort}:127.0.0.1:${remotePort}`,
      host,
    ],
    stdout: "ignore",
    stderr: "pipe",
    stdin: "ignore",
  });

  proc.exited.then(() => {
    if (tunnels.get(id)?.process === proc) tunnels.delete(id);
  });

  tunnels.set(id, { localPort, process: proc });

  if (!(await waitForPort(localPort))) {
    closeTunnel(host, remotePort);
    throw new Error(`could not open an SSH forward to ${host}:${remotePort}`);
  }

  return localPort;
}

export function closeTunnel(host: string, remotePort: number): void {
  const id = key(host, remotePort);
  const tunnel = tunnels.get(id);

  if (!tunnel) return;

  tunnel.process.kill();
  tunnels.delete(id);
}

export function closeTunnelsForHost(host: string): void {
  for (const [id, tunnel] of tunnels) {
    if (id.startsWith(`${host}:`)) {
      tunnel.process.kill();
      tunnels.delete(id);
    }
  }
}
