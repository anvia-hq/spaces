import { config } from "../../config.ts";
import { store } from "../../db.ts";
import { localDriver } from "../driver/service.ts";
import { listMachineSizes } from "../machine-sizes/service.ts";
import { ensureLocalRuntime } from "../runtimes/service.ts";

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

export async function health() {
  await ensureLocalRuntime();
  const runtimes = await store.listRuntimes();
  const local = config.runtime.local ? localDriver() : null;

  return {
    ok: true as const,
    driver: local?.kind ?? "none",
    capabilities: local?.capabilities ?? { exec: false, files: false, persistence: false },
    runtimes: {
      online: runtimes.filter((row) => row.state === "online").length,
      total: runtimes.length,
    },
    uptime: process.uptime(),
  };
}
