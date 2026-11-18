import type { RuntimeRow } from "../../db.ts";
import type { MachineSpec } from "../driver/types.ts";

export interface SchedulingRequest {
  pin?: string;
  sourceRuntimeId?: string;
  size?: MachineSpec;
}

export interface RuntimeLoad {
  active: number;
  total: number;
  snapshots: number;
  vcpu: number;
  memMib: number;
}

export interface Capacity {
  vcpu: number;
  memMib: number;
}

export interface Room {
  capacity: Capacity;
  free: Capacity;
  fits: boolean;
  utilization: number;
}

export interface CreatedRuntime {
  runtime: RuntimeRow;
  token: string;
}

export interface ConnectionSocket {
  send(text: string): void;
  close(code?: number, reason?: string): void;
}
