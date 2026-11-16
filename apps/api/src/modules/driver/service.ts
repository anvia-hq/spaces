import { config } from "../../config.ts";
import { MicrosandboxDriver } from "./microsandbox.ts";
import { MockDriver } from "./mock.ts";
import { tracedDriver } from "../traces/proxies.ts";
import type { SandboxDriver } from "./types.ts";

let instance: SandboxDriver | null = null;

export function driver(): SandboxDriver {
  if (instance) return instance;

  instance =
    config.driver === "microsandbox"
      ? new MicrosandboxDriver({
          host: config.msbHost,
          msbPath: config.msbPath,
          image: config.msbImage,
        })
      : new MockDriver();

  instance = tracedDriver(instance);

  return instance;
}
