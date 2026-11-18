import type { PortMapping, SandboxDriver } from "../driver/types.ts";
import { newId } from "@spaces/shared/errors";
import { now, store, type RuntimeRow } from "../../db.ts";
import { config } from "../../config.ts";
import { driverFor } from "../driver/service.ts";

export function portRangeOf(runtime: RuntimeRow): { start: number; end: number } | null {
  if (!runtime.portStart || !runtime.portEnd || runtime.portEnd < runtime.portStart) return null;

  return { start: runtime.portStart, end: runtime.portEnd };
}

export function bindOf(runtime: RuntimeRow): string {
  return runtime.portBind ?? config.portBind;
}

export async function allocateHostPort(
  runtime: RuntimeRow,
  taken?: Set<number>,
  listening?: Set<number> | null,
): Promise<number | null> {
  const range = portRangeOf(runtime);

  if (!range) return null;

  const driver = driverFor(runtime.id);
  const inUse = listening === undefined ? await listeningOn(driver) : listening;
  const reserved = taken ?? new Set(await store.allHostPorts(runtime.id));

  for (let port = range.start; port <= range.end; port += 1) {
    if (reserved.has(port)) continue;

    if (inUse ? !inUse.has(port) : await driver.isPortFree(port, bindOf(runtime))) return port;
  }

  return null;
}

export async function listeningOn(driver: SandboxDriver): Promise<Set<number> | null> {
  const ports = await driver.listeningPorts();

  return ports ? new Set(ports) : null;
}

export async function reservePrepublishPorts(
  sandboxId: string,
  runtime: RuntimeRow,
): Promise<PortMapping[]> {
  if (!portRangeOf(runtime)) return [];

  const taken = new Set(await store.allHostPorts(runtime.id));
  const listening = await listeningOn(driverFor(runtime.id));
  const bind = bindOf(runtime);
  const reservations: PortMapping[] = [];

  for (const guestPort of config.prepublishPorts) {
    const hostPort = await allocateHostPort(runtime, taken, listening);

    if (!hostPort) break;

    taken.add(hostPort);
    reservations.push({ bind, hostPort, guestPort });
    await store.insertPort({
      id: newId("prt"),
      sandboxId,
      guestPort,
      hostPort,
      bind,
      createdAt: now(),
    });
  }

  return reservations;
}

export async function republishPorts(id: string, driver: SandboxDriver): Promise<void> {
  for (const row of await store.listPorts(id)) {
    await driver
      .publishPort(id, { bind: row.bind, hostPort: row.hostPort, guestPort: row.guestPort })
      .catch(() => {});
  }
}
