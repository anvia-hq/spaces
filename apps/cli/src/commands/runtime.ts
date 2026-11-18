import { readFile } from "node:fs/promises";
import { boolFlag } from "../args.ts";
import { agentEntry, refFile, runtimeEnvFile, runtimeLogFile, spacesHome } from "../home.ts";
import { loadRuntimeEnv, readStoredSettings } from "../runtime-config.ts";
import { RUNTIME_SERVICE, serviceManager } from "../service-manager.ts";
import type { Args } from "../types.ts";

const manager = () => serviceManager(RUNTIME_SERVICE);

export async function runtimeRun(): Promise<void> {
  const home = spacesHome();

  if (!(await loadRuntimeEnv(runtimeEnvFile(home)))) {
    throw new Error(
      `no runtime settings in ${runtimeEnvFile(home)}. Run: spaces install --runtime ...`,
    );
  }

  await import(agentEntry(home));
}

export async function runtimeStatus(): Promise<void> {
  const home = spacesHome();
  const stored = await readStoredSettings(runtimeEnvFile(home));
  const ref = (await readFile(refFile(home), "utf8").catch(() => "unknown")).trim();

  console.log(`service    ${await manager().status()}`);
  console.log(`control    ${stored?.SPACES_CONTROL_URL ?? "not configured"}`);
  console.log(
    `token      ${stored?.SPACES_RUNTIME_TOKEN ? `${stored.SPACES_RUNTIME_TOKEN.slice(0, 12)}…` : "not configured"}`,
  );
  console.log(`source     ${ref}`);
  console.log(`log        ${runtimeLogFile(home)}`);
}

export async function runtimeLogs(args: Args): Promise<void> {
  const file = runtimeLogFile(spacesHome());

  if (boolFlag(args, "follow") || boolFlag(args, "f")) {
    const proc = Bun.spawn(["tail", "-n", "50", "-f", file], {
      stdout: "inherit",
      stderr: "inherit",
    });
    await proc.exited;
    return;
  }

  const text = await readFile(file, "utf8").catch(() => "");
  console.log(text.split("\n").slice(-50).join("\n"));
}

export async function runtimeControl(action: "start" | "stop" | "restart"): Promise<void> {
  await manager()[action]();
  console.log(`runtime ${action === "stop" ? "stopped" : `${action}ed`}`);
}
