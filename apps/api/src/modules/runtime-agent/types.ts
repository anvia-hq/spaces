import type { SandboxDriver } from "../driver/types.ts";

export interface AgentOptions {
  url: string;
  token: string;
  driver: SandboxDriver;
  version: string;
  resources: { vcpu: number; memMib: number } | null;
  portRange: { start: number; end: number } | null;
  portBind: string;
  publicHost: string | null;
  backoff?: { minMs: number; maxMs: number };
  heartbeatMs?: number | undefined;
  log?: (message: string) => void;
}

export interface AgentHandle {
  connected: Promise<void>;
  isConnected(): boolean;
  stop(): Promise<void>;
}
