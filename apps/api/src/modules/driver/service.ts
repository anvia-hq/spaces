import { LOCAL_RUNTIME_ID } from "@spaces/shared/runtime";
import { config } from "../../config.ts";
import { RuntimeUnavailable } from "../../errors.ts";
import { tracedDriver } from "../traces/proxies.ts";
import { MicrosandboxDriver } from "./microsandbox.ts";
import { MockDriver } from "./mock.ts";
import type { AttachedDriver, SandboxDriver } from "./types.ts";

let built: SandboxDriver | null = null;
const attached = new Map<string, AttachedDriver>();
const names = new Map<string, string>();

export function buildDriver(): SandboxDriver {
  return config.driver === "microsandbox"
    ? new MicrosandboxDriver({
        host: config.msbHost,
        msbPath: config.msbPath,
        image: config.msbImage,
      })
    : new MockDriver();
}

export function localDriver(): SandboxDriver {
  if (!config.runtime.local) {
    throw new RuntimeUnavailable("the built-in runtime is turned off (SPACES_LOCAL_RUNTIME=off)");
  }

  built ??= tracedDriver(buildDriver(), LOCAL_RUNTIME_ID);

  return built;
}

export function driverFor(runtimeId: string): SandboxDriver {
  if (runtimeId === LOCAL_RUNTIME_ID) return localDriver();

  const entry = attached.get(runtimeId);

  if (!entry)
    throw new RuntimeUnavailable(`runtime ${names.get(runtimeId) ?? runtimeId} is offline`);

  return entry.driver;
}

export function attachDriver(
  runtimeId: string,
  driver: SandboxDriver,
  label: string,
): AttachedDriver {
  const entry = { driver: tracedDriver(driver, runtimeId), label };
  attached.set(runtimeId, entry);
  names.set(runtimeId, label);

  return entry;
}

export function detachDriver(runtimeId: string, entry: AttachedDriver): void {
  if (attached.get(runtimeId) === entry) attached.delete(runtimeId);
}
