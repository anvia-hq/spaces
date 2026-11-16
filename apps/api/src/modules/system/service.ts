import { config } from "../../config.ts";
import { store } from "../../db.ts";
import { driver } from "../driver/service.ts";
import { listMachineSizes } from "../machine-sizes/service.ts";

export async function limits() {
  const sizes = await listMachineSizes(false);
  return {
    ok: true as const,
    type: "limits" as const,
    limits: {
      maxSandboxes: config.limits.maxSandboxes,
      maxSnapshots: config.limits.maxSnapshots,
      maxTtlSeconds: config.limits.maxTtlSeconds,
      allowedTypes: sizes.map((size) => size.name),
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
