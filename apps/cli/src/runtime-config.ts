import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseEnv, setEnv } from "./env-file.ts";
import type { RuntimeSettings } from "./types.ts";

const HEADER = `# The settings of this machine's spaces runtime, written by \`spaces install\`.
# Any other SPACES_ setting the agent reads (SPACES_PORT_RANGE_START, SPACES_NET, ...)
# can be added here; \`spaces runtime restart\` applies a change.
`;

export const PASSTHROUGH = [
  "SPACES_PORT_RANGE_START",
  "SPACES_PORT_RANGE_END",
  "SPACES_PORT_BIND",
  "SPACES_RUNTIME_VCPU",
  "SPACES_RUNTIME_MEM_MIB",
  "SPACES_RUNTIME_RESERVE_MIB",
  "SPACES_NET",
  "SPACES_NET_RULES",
  "SPACES_BOOTSTRAP",
];

export function passthroughFrom(env: Record<string, string | undefined>): Record<string, string> {
  const picked: Record<string, string> = {};

  for (const key of PASSTHROUGH) {
    const value = env[key];

    if (value) picked[key] = value;
  }

  return picked;
}

export async function writeRuntimeEnv(file: string, settings: RuntimeSettings): Promise<void> {
  const existing = await readFile(file, "utf8").catch(() => HEADER);
  const values: Record<string, string> = {
    SPACES_DRIVER: "microsandbox",
    SPACES_CONTROL_URL: settings.url,
    SPACES_RUNTIME_TOKEN: settings.token,
    SPACES_MSB: settings.msb,
    ...settings.extra,
  };

  if (settings.publicHost) values.SPACES_RUNTIME_PUBLIC_HOST = settings.publicHost;

  if (settings.image) values.SPACES_MSB_IMAGE = settings.image;

  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, setEnv(existing, values), { mode: 0o600 });
  await chmod(file, 0o600);
}

export async function readStoredSettings(
  file: string,
): Promise<Record<string, string> | undefined> {
  const text = await readFile(file, "utf8").catch(() => undefined);

  return text === undefined ? undefined : parseEnv(text);
}

export async function loadRuntimeEnv(
  file: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const stored = await readStoredSettings(file);

  if (stored === undefined) return false;

  for (const [key, value] of Object.entries(stored)) env[key] ??= value;

  return true;
}
