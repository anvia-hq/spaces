import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const INSTALL = join(import.meta.dir, "..", "install.sh");
const TOKEN = `spr_${"c".repeat(48)}`;
const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fakeMachine(options: { bun?: boolean; msb?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "spaces-install-sh-"));
  roots.push(root);
  const bin = join(root, "fakebin");
  const home = join(root, "home");
  const spacesHome = join(home, ".spaces");
  const binDir = join(root, "userbin");
  const calls = join(root, "bun-calls.log");
  await mkdir(bin, { recursive: true });
  await mkdir(home, { recursive: true });

  if (options.bun !== false) {
    await writeFile(
      bin + "/bun",
      `#!/bin/sh\nprintf '%s|%s\\n' "$(pwd)" "$*" >> "${calls}"\nexit 0\n`,
    );
    await chmod(bin + "/bun", 0o755);
  }

  if (options.msb !== false) {
    await writeFile(bin + "/msb", "#!/bin/sh\nexit 0\n");
    await chmod(bin + "/msb", 0o755);
  }

  const tree = join(root, "tree", "spaces-main");
  await mkdir(join(tree, "apps", "cli", "src"), { recursive: true });
  await writeFile(join(tree, "apps", "cli", "src", "main.ts"), "");
  await writeFile(join(tree, "bun.lock"), "");
  const archive = join(root, "source.tar.gz");
  const tar = Bun.spawnSync(["tar", "-czf", archive, "-C", join(root, "tree"), "spaces-main"]);
  expect(tar.exitCode).toBe(0);

  async function run(args: string[], extra: Record<string, string> = {}) {
    const proc = Bun.spawn(["/bin/bash", INSTALL, ...args], {
      env: {
        PATH: `${bin}:/usr/bin:/bin`,
        HOME: home,
        SHELL: "/bin/sh",
        SPACES_HOME: spacesHome,
        SPACES_BIN_DIR: binDir,
        SPACES_SOURCE_URL: `file://${archive}`,
        ...extra,
      },
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    return { code: await proc.exited, stdout, stderr };
  }

  const bunCalls = async () =>
    (await readFile(calls, "utf8").catch(() => "")).split("\n").filter(Boolean);

  return { root, home, spacesHome, binDir, run, bunCalls };
}

describe("install.sh", () => {
  test("--help explains the command and touches nothing", async () => {
    const machine = await fakeMachine();
    const result = await machine.run(["--help"]);

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--runtime --url");
    expect(await stat(machine.spacesHome).catch(() => null)).toBeNull();
  });

  test("with no arguments and nothing installed it says what to pass", async () => {
    const machine = await fakeMachine();
    const result = await machine.run([]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("pass --runtime, --url and --token");
    expect(await stat(machine.spacesHome).catch(() => null)).toBeNull();
  });

  test("a full install fetches the source, installs a launcher and hands every argument on", async () => {
    const machine = await fakeMachine();
    const args = ["--runtime", "--url", "https://spaces.example.com", "--token", TOKEN];
    const result = await machine.run(args);

    expect(result.code).toBe(0);
    expect((await readFile(join(machine.spacesHome, "src", ".spaces-ref"), "utf8")).trim()).toBe(
      "main",
    );
    expect(
      await stat(join(machine.spacesHome, "src", "apps", "cli", "src", "main.ts")),
    ).toBeTruthy();

    const launcher = await readFile(join(machine.binDir, "spaces"), "utf8");
    expect(launcher).toContain(join(machine.spacesHome, "src", "apps", "cli", "src", "main.ts"));
    expect((await stat(join(machine.binDir, "spaces"))).mode & 0o111).not.toBe(0);

    const [deps, cli] = await machine.bunCalls();
    expect(deps).toBe(`${join(machine.spacesHome, "src")}|install --frozen-lockfile`);
    expect(cli!.split("|")[1]).toBe(
      `${join(machine.spacesHome, "src", "apps", "cli", "src", "main.ts")} install ${args.join(" ")}`,
    );
  });

  test("the token is never echoed by the installer", async () => {
    const machine = await fakeMachine();
    const result = await machine.run(["--runtime", "--url", "https://x.test", "--token", TOKEN]);

    expect(result.stdout).not.toContain(TOKEN);
    expect(result.stderr).not.toContain(TOKEN);
  });

  test("the ref and the source can be chosen", async () => {
    const machine = await fakeMachine();
    await machine.run(["--runtime"], { SPACES_INSTALL_REF: "v1.2.3" });

    expect((await readFile(join(machine.spacesHome, "src", ".spaces-ref"), "utf8")).trim()).toBe(
      "v1.2.3",
    );
  });

  test("run again with no arguments it updates: old source gone, settings left, --runtime passed", async () => {
    const machine = await fakeMachine();
    await machine.run(["--runtime", "--url", "https://x.test", "--token", TOKEN]);
    await writeFile(join(machine.spacesHome, "runtime.env"), `SPACES_RUNTIME_TOKEN=${TOKEN}\n`);
    await writeFile(join(machine.spacesHome, "src", "stale-file"), "old");

    const result = await machine.run([]);

    expect(result.code).toBe(0);
    expect(await stat(join(machine.spacesHome, "src", "stale-file")).catch(() => null)).toBeNull();
    expect(await readFile(join(machine.spacesHome, "runtime.env"), "utf8")).toContain(TOKEN);
    expect(await stat(join(machine.spacesHome, "src.new")).catch(() => null)).toBeNull();
    expect(await stat(join(machine.spacesHome, "src.old")).catch(() => null)).toBeNull();

    const last = (await machine.bunCalls()).at(-1)!;
    expect(last.endsWith("install --runtime")).toBe(true);
  });

  test("a download that fails changes nothing about the source already there", async () => {
    const machine = await fakeMachine();
    await machine.run(["--runtime", "--url", "https://x.test", "--token", TOKEN]);
    await writeFile(join(machine.spacesHome, "src", "keep-me"), "still here");

    const result = await machine.run(["--runtime"], {
      SPACES_SOURCE_URL: "file:///does/not/exist.tar.gz",
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Could not download");
    expect(await readFile(join(machine.spacesHome, "src", "keep-me"), "utf8")).toBe("still here");
  });

  test("an archive that is not a spaces source tree is refused", async () => {
    const machine = await fakeMachine();
    const bogus = join(machine.root, "bogus.tar.gz");
    await mkdir(join(machine.root, "bogus", "top"), { recursive: true });
    await writeFile(join(machine.root, "bogus", "top", "readme"), "x");
    Bun.spawnSync(["tar", "-czf", bogus, "-C", join(machine.root, "bogus"), "top"]);

    const result = await machine.run(["--runtime"], { SPACES_SOURCE_URL: `file://${bogus}` });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not a spaces source tree");
    expect(await stat(join(machine.spacesHome, "src")).catch(() => null)).toBeNull();
  });

  test("without Bun, and nobody to ask, it stops and says what to install", async () => {
    const machine = await fakeMachine({ bun: false });
    const result = await machine.run(["--runtime"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Install Bun");
  });

  test("without msb, and nobody to ask, it stops and says what to install", async () => {
    const machine = await fakeMachine({ msb: false });
    const result = await machine.run(["--runtime"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Install msb");
  });
});
