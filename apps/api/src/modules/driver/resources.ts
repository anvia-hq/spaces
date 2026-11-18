import os from "node:os";
import type { Resources } from "@spaces/shared/runtime";
import { config } from "../../config.ts";

const MIB = 1024 * 1024;

export function detectResources(driverKind: string, hostIsLocal: boolean): Resources | null {
  const declared = {
    vcpu: Math.floor(config.runtime.vcpu),
    memMib: Math.floor(config.runtime.memMib),
  };

  if (declared.vcpu >= 1 && declared.memMib >= 256) return declared;

  if (driverKind !== "microsandbox" || !hostIsLocal) return null;

  const vcpu = declared.vcpu >= 1 ? declared.vcpu : os.cpus().length;
  const memMib =
    declared.memMib >= 256
      ? declared.memMib
      : Math.floor(os.totalmem() / MIB) - Math.max(0, Math.floor(config.runtime.reserveMib));

  return vcpu >= 1 && memMib >= 256 ? { vcpu, memMib } : null;
}
