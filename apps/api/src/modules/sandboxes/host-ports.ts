import type { PortMapping } from "../driver/types.ts";
import { newId } from "@spaces/shared/errors";
import { config } from "../../config.ts";
import { now, store } from "../../db.ts";
import { driver } from "../driver/service.ts";
import { isLocalHost, runRemote } from "../driver/ssh.ts";

/**
 * Ports already listening on the machine that hosts msb, or null when it has to
 * be probed one by one.
 *
 * A remote hypervisor host is asked once per allocation (`ss -tln`), because
 * binding a candidate port here says nothing about the machine that will
 * actually publish it.
 */
export async function remoteListeningPorts(log: boolean = false): Promise<Set<number> | null> {
  if (isLocalHost(config.msbHost)) return null;

  try {
    const { stdout, code } = await runRemote(config.msbHost, [
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

    if (log && ports.size === 0) return null;

    return ports;
  } catch {
    return null;
  }
}

/**
 * Whether the machine that will publish this port can bind it.
 *
 * The database only knows about ports this API allocated, while msb sandboxes
 * started by an earlier run (or any other process) still hold theirs — and on a
 * remote host those are on the other machine entirely.
 */
async function isHostPortFree(
  port: number,
  bind: string,
  listening: Set<number> | null,
): Promise<boolean> {
  if (listening) return !listening.has(port);

  try {
    const server = Bun.listen({ hostname: bind, port, socket: { data() {} } });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}

/** First host port in the configured range that is neither recorded nor bound. */
export async function allocateHostPort(
  taken?: Set<number>,
  listening?: Set<number> | null,
): Promise<number | null> {
  const { start, end } = config.portRange;

  if (!start || !end || end < start) return null;

  const inUse = listening === undefined ? await remoteListeningPorts() : listening;
  const reserved = taken ?? new Set(await store.allHostPorts());
  for (let port = start; port <= end; port += 1) {
    if (reserved.has(port)) continue;

    if (await isHostPortFree(port, config.portBind, inUse)) return port;
  }
  return null;
}

/**
 * Reserve a host port for each pre-published guest port and record it, so
 * `POST /host` on a common dev-server port is instant rather than a restart.
 */
export async function reservePrepublishPorts(sandboxId: string): Promise<PortMapping[]> {
  if (!config.portRange.start) return [];

  const taken = new Set(await store.allHostPorts());
  // One round trip for the whole reservation instead of one per candidate.
  const listening = await remoteListeningPorts();
  const reservations: PortMapping[] = [];

  for (const guestPort of config.prepublishPorts) {
    const hostPort = await allocateHostPort(taken, listening);

    if (!hostPort) break; // Range exhausted: host the rest on demand instead.

    taken.add(hostPort);
    const mapping = { bind: config.portBind, hostPort, guestPort };
    reservations.push(mapping);
    await store.insertPort({
      id: newId("prt"),
      sandboxId,
      guestPort,
      hostPort,
      bind: config.portBind,
      createdAt: now(),
    });
  }
  return reservations;
}

/**
 * Re-assert published ports after the machine boots again. Cheap when the
 * mapping survived `msb start` (modify is idempotent) and fixes it when not.
 */
export async function republishPorts(id: string, _ip: string | null): Promise<void> {
  for (const row of await store.listPorts(id)) {
    await driver()
      .publishPort(id, { bind: row.bind, hostPort: row.hostPort, guestPort: row.guestPort })
      .catch(() => {});
  }
}
