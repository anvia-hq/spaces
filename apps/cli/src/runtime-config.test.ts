import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadRuntimeEnv,
  passthroughFrom,
  readStoredSettings,
  writeRuntimeEnv,
} from "./runtime-config.ts";

const dirs: string[] = [];

async function scratch() {
  const dir = await mkdtemp(join(tmpdir(), "spaces-cli-"));
  dirs.push(dir);

  return join(dir, "nested", "runtime.env");
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const settings = {
  url: "https://spaces.example.com",
  token: `spr_${"a".repeat(48)}`,
  publicHost: undefined,
  image: undefined,
  msb: "/home/u/.microsandbox/bin/msb",
  extra: {},
};

describe("runtime.env", () => {
  test("written 0600 in a directory that did not exist, with the driver pinned", async () => {
    const file = await scratch();
    await writeRuntimeEnv(file, settings);

    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await readStoredSettings(file)).toEqual({
      SPACES_DRIVER: "microsandbox",
      SPACES_CONTROL_URL: settings.url,
      SPACES_RUNTIME_TOKEN: settings.token,
      SPACES_MSB: settings.msb,
    });
  });

  test("optional settings are written only when given", async () => {
    const file = await scratch();
    await writeRuntimeEnv(file, { ...settings, publicHost: "edge.example.com", image: "ubuntu" });
    const stored = await readStoredSettings(file);

    expect(stored?.SPACES_RUNTIME_PUBLIC_HOST).toBe("edge.example.com");
    expect(stored?.SPACES_MSB_IMAGE).toBe("ubuntu");
  });

  test("a second write changes what it is given and keeps what a person added by hand", async () => {
    const file = await scratch();
    await writeRuntimeEnv(file, settings);
    await writeFile(file, `${await readFile(file, "utf8")}SPACES_NET=none\n`);

    const next = `spr_${"b".repeat(48)}`;
    await writeRuntimeEnv(file, { ...settings, token: next });
    const stored = await readStoredSettings(file);

    expect(stored?.SPACES_RUNTIME_TOKEN).toBe(next);
    expect(stored?.SPACES_NET).toBe("none");
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  test("loading fills the environment without overriding what is already set", async () => {
    const file = await scratch();
    await writeRuntimeEnv(file, settings);
    const env: Record<string, string | undefined> = { SPACES_CONTROL_URL: "https://override.test" };

    expect(await loadRuntimeEnv(file, env)).toBe(true);
    expect(env.SPACES_CONTROL_URL).toBe("https://override.test");
    expect(env.SPACES_RUNTIME_TOKEN).toBe(settings.token);
  });

  test("a machine with no settings loads nothing and says so", async () => {
    expect(await loadRuntimeEnv(await scratch(), {})).toBe(false);
  });

  test("only the settings an operator is meant to carry over are taken from the environment", () => {
    expect(
      passthroughFrom({
        SPACES_PORT_RANGE_START: "24000",
        SPACES_NET: "",
        SPACES_API_KEY: "never",
        PATH: "/bin",
      }),
    ).toEqual({ SPACES_PORT_RANGE_START: "24000" });
  });
});
