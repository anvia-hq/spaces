import { DRIVER_METHODS, type DriverCapabilities, type DriverMethod } from "@spaces/shared/runtime";
import type { DriverTransport, SandboxDriver } from "./types.ts";

type Callable = Exclude<keyof SandboxDriver, "kind" | "capabilities">;
type Unlisted = Exclude<Callable, DriverMethod>;
type Unknown = Exclude<DriverMethod, Callable>;

const everyMethodCrossesTheWire: [Unlisted | Unknown] extends [never] ? true : never = true;

export function remoteDriver(
  transport: DriverTransport,
  identity: { kind: string; capabilities: DriverCapabilities },
): SandboxDriver {
  const methods: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  for (const method of DRIVER_METHODS) {
    methods[method] = (...args) => transport.call(method, args);
  }

  void everyMethodCrossesTheWire;

  return asDriver({ kind: identity.kind, capabilities: identity.capabilities, ...methods });
}

function asDriver(candidate: object): SandboxDriver {
  return candidate as SandboxDriver;
}
