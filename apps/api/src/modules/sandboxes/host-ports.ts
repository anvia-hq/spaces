import type { CreateHostedPortRequest } from "@spaces/shared/sandbox";
import type { PortMapping, SandboxDriver } from "../driver/types.ts";
import { newId } from "@spaces/shared/errors";
import { now, store, type RuntimeRow } from "../../db.ts";
import { config } from "../../config.ts";
import { ServiceError } from "../../errors.ts";
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
  requested: CreateHostedPortRequest[] = [],
): Promise<PortMapping[]> {
  const range = portRangeOf(runtime);

  if (!range) {
    if (requested.length > 0) {
      throw new ServiceError(
        "provider_not_configured",
        runtime.kind === "local"
          ? "Port publishing is disabled on this server (SPACES_PORT_RANGE_START=0)."
          : `Port publishing is disabled on runtime ${runtime.name} (no port range advertised).`,
      );
    }

    return [];
  }

  const taken = new Set(await store.allHostPorts(runtime.id));
  const listening = await listeningOn(driverFor(runtime.id));
  const bind = bindOf(runtime);
  const reservations: PortMapping[] = [];
  const reservedGuestPorts = new Set<number>();

  const uniqueRequested = new Map<number, CreateHostedPortRequest>();

  for (const item of requested) uniqueRequested.set(item.port, item);

  for (const item of uniqueRequested.values()) {
    const hostPort = await allocateHostPort(runtime, taken, listening);

    if (!hostPort) {
      throw new ServiceError(
        "provider_not_configured",
        `No free host port in ${range.start}-${range.end} on runtime ${runtime.name}.`,
      );
    }

    taken.add(hostPort);
    reservedGuestPorts.add(item.port);
    reservations.push({ bind, hostPort, guestPort: item.port });
    await store.insertPort({
      id: newId("prt"),
      sandboxId,
      guestPort: item.port,
      hostPort,
      bind,
      title: item.title ?? null,
      public: item.public ?? false,
      localhost: item.localhost ?? false,
      explicit: true,
      createdAt: now(),
    });
  }

  for (const guestPort of config.prepublishPorts) {
    if (reservedGuestPorts.has(guestPort)) continue;

    const hostPort = await allocateHostPort(runtime, taken, listening);

    if (!hostPort) break;

    taken.add(hostPort);
    reservedGuestPorts.add(guestPort);
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
