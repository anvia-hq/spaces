import type { MachineSizeRow } from "@spaces/db";
import type { MachineSize } from "@spaces/shared/sandbox";
import { DEFAULT_MACHINE_SIZE, RETIRED_MACHINE_SIZE } from "@spaces/shared/sandbox";
import { now, store } from "../../db.ts";
import { ServiceError } from "../../errors.ts";
import type { ActiveMachineSize } from "./types.ts";

function shape(row: MachineSizeRow): MachineSize {
  return {
    name: row.name,
    vcpu: row.vcpu,
    memMib: row.memMib,
    diskGb: row.diskGb,
    description: row.description,
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMachineSizes(includeRetired = false): Promise<MachineSize[]> {
  return (await store.listMachineSizes(includeRetired)).map(shape);
}

/**
 * The preset a sandbox is created with. Unknown and retired names answer the
 * same way: a name that cannot be booted is not a size, whatever it used to be
 * (docs/decision/0034). No names are reserved for later, because the operator
 * owns the list.
 */
export async function requireActiveMachineSize(name: string): Promise<ActiveMachineSize> {
  const row = await store.machineSize(name);

  if (!row) {
    throw new ServiceError(
      "not_found",
      `${RETIRED_MACHINE_SIZE}: no machine size named ${name}; GET /machine-sizes lists the ones this deployment has`,
    );
  }

  if (row.retiredAt) {
    throw new ServiceError(
      "not_found",
      `${RETIRED_MACHINE_SIZE}: machine size ${name} was retired; pick an active one`,
    );
  }

  return { name: row.name, vcpu: row.vcpu, memMib: row.memMib, diskGb: row.diskGb };
}

export async function createMachineSize(input: {
  name: string;
  vcpu: number;
  memMib: number;
  diskGb: number;
  description?: string | null;
}): Promise<MachineSize> {
  if (await store.machineSize(input.name)) {
    throw new ServiceError(
      "destination_exists",
      `machine size ${input.name} already exists; PATCH it, or DELETE it first to reuse the name`,
    );
  }

  const ts = new Date(now());
  await store.insertMachineSize({
    name: input.name,
    vcpu: input.vcpu,
    memMib: input.memMib,
    diskGb: input.diskGb,
    description: input.description ?? null,
    at: ts,
  });
  return shape((await store.machineSize(input.name))!);
}

export async function updateMachineSize(
  name: string,
  patch: { vcpu?: number; memMib?: number; diskGb?: number; description?: string | null },
): Promise<MachineSize> {
  const row = await store.machineSize(name);

  if (!row) throw new ServiceError("not_found", `no machine size named ${name}`);

  if (row.retiredAt) {
    throw new ServiceError(
      "forbidden",
      `${RETIRED_MACHINE_SIZE}: ${name} was retired and cannot be edited; create it again to reuse the name`,
    );
  }

  await store.updateMachineSize(name, patch);
  return shape((await store.machineSize(name))!);
}

/** Soft retire: existing sandboxes keep their row and stay readable. */
export async function retireMachineSize(
  name: string,
): Promise<{ name: string; retiredAt: string; inUse: number }> {
  const row = await store.machineSize(name);

  if (!row) throw new ServiceError("not_found", `no machine size named ${name}`);

  if (row.retiredAt) {
    return { name, retiredAt: row.retiredAt.toISOString(), inUse: await store.countOfType(name) };
  }

  if (name === DEFAULT_MACHINE_SIZE) {
    throw new ServiceError(
      "forbidden",
      `${DEFAULT_MACHINE_SIZE} is the size a create falls back to and cannot be retired`,
    );
  }

  await store.updateMachineSize(name, { retiredAt: now() });
  return {
    name,
    retiredAt: (await store.machineSize(name))!.retiredAt!.toISOString(),
    inUse: await store.countOfType(name),
  };
}
