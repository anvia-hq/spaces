import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eventually } from "../../testing/control-plane.ts";
import { startFleet } from "../../testing/fleet.ts";

const REPO = join(import.meta.dir, "..", "..", "..", "..", "..");
const MAIN = join(REPO, "apps", "cli", "src", "main.ts");

const fleet = await startFleet();
const { call, unique, register, runtimeView, createOn } = fleet;
const children: ReturnType<typeof Bun.spawn>[] = [];
const roots: string[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();

  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

afterAll(() => fleet.shutdown());

async function installedHome(settings: Record<string, string>) {
  const home = await mkdtemp(join(tmpdir(), "spaces-home-"));
  roots.push(home);
  await symlink(REPO, join(home, "src"));
  await mkdir(join(home, "logs"), { recursive: true });
  const lines = Object.entries(settings).map(([key, value]) => `${key}=${value}`);
  await writeFile(join(home, "runtime.env"), `${lines.join("\n")}\n`, { mode: 0o600 });

  return home;
}

function runService(home: string) {
  const child = Bun.spawn(["bun", MAIN, "runtime", "run"], {
    env: { PATH: process.env.PATH ?? "", HOME: home, SPACES_HOME: home },
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  children.push(child);

  return child;
}

describe("`spaces runtime run`, the command the service runs", () => {
  test("loads runtime.env, connects, takes work, and goes offline when it stops", async () => {
    const registered = await register(unique("svc"));
    const home = await installedHome({
      SPACES_DRIVER: "mock",
      SPACES_CONTROL_URL: fleet.url,
      SPACES_RUNTIME_TOKEN: registered.token,
      SPACES_RUNTIME_PUBLIC_HOST: "svc.test",
      SPACES_PORT_RANGE_START: "24300",
      SPACES_PORT_RANGE_END: "24310",
    });
    const child = runService(home);

    const view = await eventually(
      () => runtimeView(registered.id),
      (next) => next.state === "online",
      15000,
    );

    expect(view).toMatchObject({ driver: "mock", publicHost: "svc.test" });

    const made = await createOn(registered.name);
    expect(made.runtimeId).toBe(registered.id);

    const ran = await call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "uname" });
    expect(ran.status).toBe(200);

    child.kill();
    await eventually(
      () => runtimeView(registered.id),
      (next) => next.state === "offline",
    );
  });

  test("a wrong token in runtime.env never connects", async () => {
    const registered = await register(unique("badtoken"));
    const home = await installedHome({
      SPACES_DRIVER: "mock",
      SPACES_CONTROL_URL: fleet.url,
      SPACES_RUNTIME_TOKEN: `spr_${"0".repeat(48)}`,
    });
    runService(home);

    await Bun.sleep(1500);
    expect((await runtimeView(registered.id)).state).toBe("offline");
  });

  test("with no settings it says so and exits non-zero", async () => {
    const home = await mkdtemp(join(tmpdir(), "spaces-empty-"));
    roots.push(home);
    await symlink(REPO, join(home, "src"));
    const child = runService(home);
    const code = await child.exited;
    const stderr = await new Response(child.stderr).text();

    expect(code).toBe(1);
    expect(stderr).toContain("no runtime settings");
  });

  test("settings already in the environment win over the file", async () => {
    const registered = await register(unique("envwin"));
    const home = await installedHome({
      SPACES_DRIVER: "mock",
      SPACES_CONTROL_URL: "http://127.0.0.1:1",
      SPACES_RUNTIME_TOKEN: registered.token,
    });
    const child = Bun.spawn(["bun", MAIN, "runtime", "run"], {
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home,
        SPACES_HOME: home,
        SPACES_CONTROL_URL: fleet.url,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    children.push(child);

    await eventually(
      () => runtimeView(registered.id),
      (next) => next.state === "online",
      15000,
    );
  });
});
