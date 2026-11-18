import { app } from "./app.ts";
import { config } from "./config.ts";
import { store } from "./db.ts";
import { localDriver } from "./modules/driver/service.ts";
import { runtimeWebsocket } from "./modules/runtimes/connect.ts";
import {
  ensureLocalRuntime,
  isRuntimeReachable,
  resetRuntimeStates,
} from "./modules/runtimes/service.ts";
import { sweepLiveness } from "./modules/runtimes/session.ts";
import { stopSandbox } from "./modules/sandboxes/service.ts";
import { promoteListedAtBoot, promotionEntry } from "./modules/auth/admins.ts";
import * as audit from "./modules/audit/service.ts";

/**
 * Auto-stop: boat archives a sandbox when its TTL lapses. Every sweep stops the
 * machine so it stops consuming host resources, and leaves the disk for resume.
 */
async function reap() {
  const now = Date.now();
  const due = (await store.list()).filter((sandbox) => {
    if (!["ready", "running", "idle", "provisioning"].includes(sandbox.state)) return false;

    if (!sandbox.archiveAfter) return false;

    if (!isRuntimeReachable(sandbox.runtimeId)) return false;

    return new Date(sandbox.archiveAfter).getTime() <= now;
  });

  for (const sandbox of due) {
    try {
      await stopSandbox(sandbox.id);
      await store.event(sandbox.id, "sandbox.auto_stopped", { reason: "ttl" });
      console.log(`[reaper] auto-stopped ${sandbox.id}`);
    } catch (error) {
      console.warn(
        `[reaper] could not stop ${sandbox.id}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
}

setInterval(() => void reap(), config.reaperIntervalMs);

/**
 * `SPACES_ADMIN_EMAILS` also covers accounts that already exist, so a deployment
 * with one user on it needs no SQL step to get its first admin (decision 0037).
 */
const promoted = await promoteListedAtBoot().catch((error: unknown) => {
  console.warn("[api] admin bootstrap failed:", error instanceof Error ? error.message : error);
  return [] as string[];
});

for (const userId of promoted) {
  await audit.record(promotionEntry(userId, null, "boot")).catch(() => undefined);
}

if (promoted.length > 0) {
  console.log(`[api] promoted ${promoted.length} account(s) from SPACES_ADMIN_EMAILS`);
}

/** Traces fill the table faster than anything else; sweep them on a slow timer. */
async function sweep() {
  if (config.traces.retentionDays <= 0) return;

  const cutoff = new Date(Date.now() - config.traces.retentionDays * 86_400_000).toISOString();

  try {
    const removed = await store.sweepSpans(cutoff);

    if (removed > 0) console.log(`[reaper] swept ${removed} spans older than ${cutoff}`);
  } catch (error) {
    console.warn("[reaper] span sweep failed:", error instanceof Error ? error.message : error);
  }
}

setInterval(() => void sweep(), 10 * 60_000);

await resetRuntimeStates();
await ensureLocalRuntime();
setInterval(() => sweepLiveness(), config.runtime.offlineSweepMs);

console.log(
  config.runtime.local
    ? `[api] driver=${localDriver().kind} capabilities=${JSON.stringify(localDriver().capabilities)} port=${config.port}`
    : `[api] built-in runtime off; waiting for agents on port=${config.port}`,
);

export default {
  port: config.port,
  hostname: config.bindHost,
  fetch: app.fetch,
  websocket: runtimeWebsocket,
  /** Long command timeouts need a generous idle window. */
  idleTimeout: 255,
};
