import type { MachineSpec } from "../driver/types.ts";
import type { Capacity, Room, RuntimeLoad } from "./types.ts";

export function capacityOf(
  resources: { vcpu: number | null; memMib: number | null },
  overcommit: number,
): Capacity | null {
  if (!resources.vcpu || !resources.memMib) return null;

  const factor = overcommit > 0 ? overcommit : 1;

  return {
    vcpu: Math.floor(resources.vcpu * factor),
    memMib: Math.floor(resources.memMib * factor),
  };
}

export function roomFor(capacity: Capacity, load: RuntimeLoad, size: MachineSpec): Room {
  const free = {
    vcpu: Math.max(0, capacity.vcpu - load.vcpu),
    memMib: Math.max(0, capacity.memMib - load.memMib),
  };
  const fits = size.vcpu <= free.vcpu && size.memMib <= free.memMib;
  const utilization = Math.max(
    (load.vcpu + size.vcpu) / capacity.vcpu,
    (load.memMib + size.memMib) / capacity.memMib,
  );

  return { capacity, free, fits, utilization };
}

export function noRoomMessage(name: string, size: MachineSpec, room: Room): string {
  return (
    `runtime ${name} has no room for ${size.vcpu} vCPU / ${size.memMib} MiB ` +
    `(free: ${room.free.vcpu} vCPU / ${room.free.memMib} MiB of ${room.capacity.vcpu} vCPU / ${room.capacity.memMib} MiB)`
  );
}
