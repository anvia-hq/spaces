import { MACHINE_SIZES } from "@spaces/shared/sandbox";
import type { SandboxType } from "@spaces/shared/sandbox";
import { config } from "../../config.ts";
import { store } from "../../db.ts";
import { driver } from "../driver/service.ts";

export async function limits() {
  return {
    ok: true as const,
    type: "limits" as const,
    limits: {
      maxSandboxes: config.limits.maxSandboxes,
      maxSnapshots: config.limits.maxSnapshots,
      maxTtlSeconds: config.limits.maxTtlSeconds,
      allowedTypes: Object.keys(MACHINE_SIZES) as SandboxType[],
    },
    usage: await store.counts(),
  };
}

export function health() {
  return {
    ok: true as const,
    driver: driver().kind,
    capabilities: driver().capabilities,
    uptime: process.uptime(),
  };
}
