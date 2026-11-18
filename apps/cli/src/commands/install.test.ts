import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "../args.ts";
import { runtimeEnvFile, runtimeLogFile } from "../home.ts";
import { readStoredSettings } from "../runtime-config.ts";
import type { InstallDeps, ServiceDefinition } from "../types.ts";
import { runtimeInstall, serviceDefinition, waitForConnection } from "./install.ts";

const TOKEN = `spr_${"a".repeat(48)}`;
const homes: string[] = [];

afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

async function fakeDeps(overrides: Partial<InstallDeps> = {}) {
  const home = await mkdtemp(join(tmpdir(), "spaces-install-"));
  homes.push(home);
  const installed: ServiceDefinition[] = [];
  const printed: string[] = [];
  const deps: InstallDeps = {
    env: { HOME: "/home/u", PATH: "/usr/bin" },
    home,
    bun: "/home/u/.bun/bin/bun",
    entry: "/home/u/.spaces/src/apps/cli/src/main.ts",
    locateMsb: async () => "/home/u/.microsandbox/bin/msb",
    doctor: async () => ({ code: 0, out: "Host setup is ready" }),
    controlHealth: async () => true,
    checkToken: async () => ({ ok: true, message: "accepted" }),
    manager: {
      install: async (definition) => {
        installed.push(definition);
      },
      uninstall: async () => undefined,
      start: async () => undefined,
      stop: async () => undefined,
      restart: async () => undefined,
      status: async () => "running",
    },
    waitForConnection: async () => "[agent] connected to the control plane as runtime rt_1",
    print: (line) => printed.push(line),
    ...overrides,
  };

  return { deps, home, installed, printed };
}

const flags = (extra: string[] = []) =>
  parseArgs(
    ["--runtime", "--url", "https://spaces.example.com/", "--token", TOKEN, ...extra],
    ["url", "token", "public-host", "image"],
  );

describe("spaces install --runtime", () => {
  test("a good install writes the settings, installs the service and reports the connection", async () => {
    const { deps, home, installed, printed } = await fakeDeps();
    await runtimeInstall(flags(["--public-host", "edge.example.com"]), deps);

    const stored = await readStoredSettings(runtimeEnvFile(home));
    expect(stored).toMatchObject({
      SPACES_CONTROL_URL: "https://spaces.example.com",
      SPACES_RUNTIME_TOKEN: TOKEN,
      SPACES_RUNTIME_PUBLIC_HOST: "edge.example.com",
      SPACES_MSB: "/home/u/.microsandbox/bin/msb",
    });
    expect((await stat(runtimeEnvFile(home))).mode & 0o777).toBe(0o600);
    expect(installed).toHaveLength(1);
    expect(installed[0]!.command).toEqual([deps.bun, deps.entry, "runtime", "run"]);
    expect(printed.at(-1)).toBe("connected to the control plane as runtime rt_1");
  });

  test("the service finds msb and bun on its PATH, which a login shell would have given it", async () => {
    const { deps } = await fakeDeps();
    const definition = serviceDefinition(deps, "/opt/msb/bin/msb");

    expect(definition.env.PATH).toBe("/opt/msb/bin:/home/u/.bun/bin:/usr/bin");
    expect(definition.logFile).toBe(runtimeLogFile(deps.home));
  });

  test("nothing but --runtime is installed by this command, and it says what to use instead", async () => {
    const { deps } = await fakeDeps();

    await expect(runtimeInstall(parseArgs([]), deps)).rejects.toThrow("scripts/deploy.sh");
  });

  test("without a url or a token on a fresh machine it explains how to get them", async () => {
    const { deps } = await fakeDeps();

    await expect(runtimeInstall(parseArgs(["--runtime"]), deps)).rejects.toThrow(
      "Register a runtime in the console",
    );
  });

  describe("a failed check leaves nothing behind", () => {
    const cases: [string, Partial<InstallDeps>, string][] = [
      ["no msb", { locateMsb: async () => undefined }, "msb (microsandbox) is not installed"],
      [
        "a host that is not ready",
        { doctor: async () => ({ code: 1, out: "/dev/kvm: permission denied" }) },
        "/dev/kvm: permission denied",
      ],
      ["an unreachable control plane", { controlHealth: async () => false }, "cannot reach"],
      [
        "a rejected token",
        {
          checkToken: async () => ({ ok: false, message: "the control plane rejected that token" }),
        },
        "rejected that token",
      ],
    ];

    for (const [name, override, message] of cases) {
      test(name, async () => {
        const { deps, home, installed } = await fakeDeps(override);

        await expect(runtimeInstall(flags(), deps)).rejects.toThrow(message);
        expect(await stat(runtimeEnvFile(home)).catch(() => null)).toBeNull();
        expect(installed).toHaveLength(0);
      });
    }
  });

  test("a malformed token is refused before anything is contacted", async () => {
    let contacted = false;
    const { deps } = await fakeDeps({
      controlHealth: async () => {
        contacted = true;
        return true;
      },
    });
    const args = parseArgs(
      ["--runtime", "--url", "https://x.test", "--token", "spr_short"],
      ["url", "token"],
    );

    await expect(runtimeInstall(args, deps)).rejects.toThrow("not a runtime token");
    expect(contacted).toBe(false);
  });

  test("plain http to a remote host warns that the token is readable", async () => {
    const { deps, printed } = await fakeDeps();
    const args = parseArgs(
      ["--runtime", "--url", "http://spaces.example.com", "--token", TOKEN],
      ["url", "token"],
    );
    await runtimeInstall(args, deps);

    expect(printed.some((line) => line.includes("clear text"))).toBe(true);
  });

  test("http to this machine does not warn", async () => {
    const { deps, printed } = await fakeDeps();
    const args = parseArgs(
      ["--runtime", "--url", "http://localhost:8787", "--token", TOKEN],
      ["url", "token"],
    );
    await runtimeInstall(args, deps);

    expect(printed.some((line) => line.includes("clear text"))).toBe(false);
  });

  test("a runtime that never connects fails with the log's last word and a pointer to the logs", async () => {
    const { deps } = await fakeDeps({
      waitForConnection: async () =>
        "[agent] could not open the control plane connection (unauthorized)",
    });

    await expect(runtimeInstall(flags(), deps)).rejects.toThrow("spaces runtime logs");
  });

  test("a runtime that says nothing at all fails too", async () => {
    const { deps } = await fakeDeps({ waitForConnection: async () => undefined });

    await expect(runtimeInstall(flags(), deps)).rejects.toThrow("did not connect");
  });

  test("a re-run needs no arguments: the stored settings are used, and a new token replaces the old", async () => {
    const { deps, home, installed } = await fakeDeps();
    await runtimeInstall(flags(), deps);
    await runtimeInstall(parseArgs(["--runtime"]), deps);

    expect(installed).toHaveLength(2);

    const next = `spr_${"b".repeat(48)}`;
    await runtimeInstall(parseArgs(["--runtime", "--token", next], ["token"]), deps);
    const stored = await readStoredSettings(runtimeEnvFile(home));

    expect(stored?.SPACES_RUNTIME_TOKEN).toBe(next);
    expect(stored?.SPACES_CONTROL_URL).toBe("https://spaces.example.com");
  });

  test("the operator's SPACES_ settings in the environment are carried into the runtime's file", async () => {
    const { deps, home } = await fakeDeps({
      env: {
        HOME: "/home/u",
        PATH: "/usr/bin",
        SPACES_PORT_RANGE_START: "24000",
        SPACES_API_KEY: "no",
      },
    });
    await runtimeInstall(flags(), deps);
    const stored = await readStoredSettings(runtimeEnvFile(home));

    expect(stored?.SPACES_PORT_RANGE_START).toBe("24000");
    expect(stored?.SPACES_API_KEY).toBeUndefined();
  });
});

describe("waiting for the connection", () => {
  test("only what the log gained since the install started counts", async () => {
    const home = await mkdtemp(join(tmpdir(), "spaces-log-"));
    homes.push(home);
    const file = join(home, "runtime.log");
    const old = "[agent] connected to the control plane as runtime rt_OLD\n";
    await Bun.write(file, old);

    expect(await waitForConnection(file, old.length, 1)).toBeUndefined();

    await Bun.write(file, `${old}[agent] connected to the control plane as runtime rt_NEW\n`);

    expect(await waitForConnection(file, old.length, 1)).toContain("rt_NEW");
  });

  test("when it never connects, the last thing the log said is what comes back", async () => {
    const home = await mkdtemp(join(tmpdir(), "spaces-log-"));
    homes.push(home);
    const file = join(home, "runtime.log");
    await Bun.write(
      file,
      "[agent] could not open the control plane connection; retrying in 1s\n[agent] could not open the control plane connection; retrying in 2s\n",
    );

    expect(await waitForConnection(file, 0, 1)).toBe(
      "[agent] could not open the control plane connection; retrying in 2s",
    );
  });
});
