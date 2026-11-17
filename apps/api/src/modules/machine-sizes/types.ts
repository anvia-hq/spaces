import type { MachineSize } from "@spaces/shared/sandbox";

/** A preset as the console and the driver use it: never retired. */
export interface ActiveMachineSize {
  name: string;
  vcpu: number;
  memMib: number;
  diskGb: number;
}

export type { MachineSize };
