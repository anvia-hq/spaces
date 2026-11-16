/**
 * Reaching a published port when `msb` runs on another machine.
 *
 * A published port binds to loopback on the hypervisor host, so the API cannot
 * dial it directly. Rather than binding the remote port on a public interface,
 * the API opens a local SSH forward and talks to that. The remote port stays on
 * 127.0.0.1 where it belongs.
 */

import { isLocalHost } from "../driver/ssh.ts";

interface Tunnel {
  localPort: number;
  process: ReturnType<typeof Bun.spawn>;
}

/** Keyed by `<host>:<remotePort>`; lives as long as the API process. */
const tunnels = new Map<string, Tunnel>();

function key(host: string, remotePort: number): string {
  return `${host}:${remotePort}`;
}

/** One free loopback port, picked by letting the kernel assign one. */
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
      // Anything that is not a connection refusal means something answered.
      const message = error instanceof Error ? error.message : String(error);

      if (!/ECONNREFUSED|Unable to connect|fetch failed/i.test(message)) return true;
    }
    await Bun.sleep(120);
  }
  return false;
}

/**
 * Local port that forwards to `remotePort` on `host`. For the local driver the
 * port is already reachable, so it is returned unchanged.
 */
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

  // A dead ssh must not leave a stale entry behind.
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

/** Drop a forward, e.g. when the port is unpublished. */
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
