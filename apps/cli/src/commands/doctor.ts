import { stat } from "node:fs/promises";
import { TOKEN_PATTERN, checkToken, controlHealth } from "../control.ts";
import { runtimeEnvFile, runtimeLogFile, spacesHome } from "../home.ts";
import { locateMsb, msbDoctor } from "../msb.ts";
import { readStoredSettings } from "../runtime-config.ts";
import { RUNTIME_SERVICE, serviceManager } from "../service-manager.ts";
import type { Check } from "../types.ts";

export async function runChecks(): Promise<Check[]> {
  const home = spacesHome();
  const checks: Check[] = [];
  const stored = await readStoredSettings(runtimeEnvFile(home));
  const url = stored?.SPACES_CONTROL_URL;
  const token = stored?.SPACES_RUNTIME_TOKEN;

  checks.push({ name: "bun", ok: true, detail: process.execPath });

  const msb = await locateMsb();
  checks.push({ name: "msb", ok: Boolean(msb), detail: msb ?? "not installed" });

  if (msb) {
    const doctor = await msbDoctor(msb);
    checks.push({
      name: "host (msb doctor)",
      ok: doctor.code === 0,
      detail: doctor.code === 0 ? "ready" : doctor.out.split("\n").slice(-4).join(" | "),
    });
  }

  checks.push({
    name: "settings",
    ok: Boolean(url && token && TOKEN_PATTERN.test(token)),
    detail:
      url && token ? `${url}, token ${token.slice(0, 12)}…` : `none in ${runtimeEnvFile(home)}`,
  });

  if (url) {
    const healthy = await controlHealth(url);
    checks.push({
      name: "control plane",
      ok: healthy,
      detail: `${url}/health ${healthy ? "answers" : "does not answer"}`,
    });

    if (token && healthy) {
      const result = await checkToken(url, token);
      checks.push({ name: "token", ok: result.ok, detail: result.message });
    }
  }

  const status = await serviceManager(RUNTIME_SERVICE)
    .status()
    .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));
  checks.push({ name: "service", ok: status.startsWith("running"), detail: status });

  const log = await stat(runtimeLogFile(home)).catch(() => undefined);
  checks.push({ name: "log", ok: log !== undefined, detail: runtimeLogFile(home) });

  return checks;
}

export function formatChecks(checks: Check[]): string {
  const width = Math.max(...checks.map((check) => check.name.length));

  return checks
    .map((check) => `${check.ok ? "ok  " : "FAIL"}  ${check.name.padEnd(width)}  ${check.detail}`)
    .join("\n");
}

export async function doctor(): Promise<number> {
  const checks = await runChecks();
  console.log(formatChecks(checks));

  return checks.every((check) => check.ok) ? 0 : 1;
}
