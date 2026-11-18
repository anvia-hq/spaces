import { readFile, stat } from "node:fs/promises";
import { delimiter, dirname } from "node:path";
import { boolFlag, stringFlag } from "../args.ts";
import { TOKEN_PATTERN, checkToken, controlHealth, normalizeUrl } from "../control.ts";
import { runtimeEnvFile, runtimeLogFile, spacesHome } from "../home.ts";
import { locateMsb, msbDoctor } from "../msb.ts";
import { passthroughFrom, readStoredSettings, writeRuntimeEnv } from "../runtime-config.ts";
import { RUNTIME_SERVICE, serviceManager } from "../service-manager.ts";
import type { Args, InstallDeps, ServiceDefinition } from "../types.ts";

const CONNECTED = /connected to the control plane/;

export function defaultInstallDeps(): InstallDeps {
  return {
    env: process.env,
    home: spacesHome(),
    bun: process.execPath,
    entry: process.argv[1] ?? "",
    locateMsb: () => locateMsb(),
    doctor: msbDoctor,
    controlHealth,
    checkToken,
    manager: serviceManager(RUNTIME_SERVICE),
    waitForConnection,
    print: (line) => console.log(line),
  };
}

export async function waitForConnection(
  logFile: string,
  from: number,
  attempts = 30,
): Promise<string | undefined> {
  let last: string | undefined;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const log = await readFile(logFile, "utf8").catch(() => "");
    const lines = log
      .slice(from)
      .split("\n")
      .filter((entry) => entry.trim() !== "");
    const connected = lines.findLast((entry) => CONNECTED.test(entry));

    if (connected) return connected;

    last = lines.at(-1) ?? last;
    await Bun.sleep(1000);
  }

  return last;
}

export function serviceDefinition(deps: InstallDeps, msb: string): ServiceDefinition {
  const env: Record<string, string> = {
    HOME: deps.env.HOME ?? "",
    PATH: [dirname(msb), dirname(deps.bun), deps.env.PATH ?? ""].filter(Boolean).join(delimiter),
  };

  if (deps.env.SPACES_HOME) env.SPACES_HOME = deps.env.SPACES_HOME;

  return {
    label: RUNTIME_SERVICE.launchdLabel,
    command: [deps.bun, deps.entry, "runtime", "run"],
    env,
    logFile: runtimeLogFile(deps.home),
    workingDirectory: deps.home,
  };
}

export async function runtimeInstall(args: Args, deps: InstallDeps): Promise<void> {
  if (!boolFlag(args, "runtime")) {
    throw new Error(
      "spaces install --runtime --url <control plane> --token <token>\n" +
        "Installing a control plane is done with scripts/deploy.sh; this installs a runtime.",
    );
  }

  const file = runtimeEnvFile(deps.home);
  const stored = (await readStoredSettings(file)) ?? {};
  const rawUrl =
    stringFlag(args, "url") ?? deps.env.SPACES_CONTROL_URL ?? stored.SPACES_CONTROL_URL;
  const token =
    stringFlag(args, "token") ?? deps.env.SPACES_RUNTIME_TOKEN ?? stored.SPACES_RUNTIME_TOKEN;

  if (!rawUrl || !token) {
    throw new Error(
      `Usage: spaces install --runtime --url <control plane> --token <token> [--public-host <host>] [--image <ref>]\n` +
        `(or SPACES_RUNTIME_TOKEN). Register a runtime in the console to get a token. ` +
        `The settings in ${file} are used when they are given nowhere.`,
    );
  }

  const url = normalizeUrl(rawUrl);

  if (!TOKEN_PATTERN.test(token)) {
    throw new Error(
      "that is not a runtime token (spr_ followed by 48 hex characters). Copy it again from the console.",
    );
  }

  if (url.startsWith("http://") && !/^http:\/\/(localhost|127\.|\[::1\])/.test(url)) {
    deps.print(`warning: ${url} is plain http, so the token crosses the network in clear text.`);
  }

  const msb = await deps.locateMsb();

  if (!msb)
    throw new Error(
      "msb (microsandbox) is not installed. The installer installs it: run it again.",
    );

  const doctor = await deps.doctor(msb);

  if (doctor.code !== 0) {
    throw new Error(`msb doctor does not report this host as ready:\n${doctor.out}`);
  }

  if (!(await deps.controlHealth(url))) {
    throw new Error(
      `cannot reach ${url}/health from this machine. The runtime only dials out, so this is the one network requirement: check DNS, TLS and any proxy.`,
    );
  }

  const check = await deps.checkToken(url, token);

  if (!check.ok) throw new Error(check.message);

  await writeRuntimeEnv(file, {
    url,
    token,
    publicHost: stringFlag(args, "public-host") ?? stored.SPACES_RUNTIME_PUBLIC_HOST,
    image: stringFlag(args, "image") ?? stored.SPACES_MSB_IMAGE,
    msb,
    extra: passthroughFrom(deps.env),
  });

  const logFile = runtimeLogFile(deps.home);
  const from = (await stat(logFile).catch(() => undefined))?.size ?? 0;

  await deps.manager.install(serviceDefinition(deps, msb));
  deps.print(`The runtime is installed as a service. Its log: ${logFile}`);

  const outcome = await deps.waitForConnection(logFile, from);

  if (!outcome || !CONNECTED.test(outcome)) {
    throw new Error(
      `the runtime did not connect to ${url}${outcome ? `: ${outcome}` : ""}\nSee: spaces runtime logs`,
    );
  }

  deps.print(outcome.replace(/^\[agent\]\s*/, ""));
}
