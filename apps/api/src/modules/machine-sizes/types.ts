import type { MachineSize } from "@spaces/shared/sandbox";

export interface ActiveMachineSize {
  name: string;
  vcpu: number;
  memMib: number;
  diskGb: number;
}

export type { MachineSize };
