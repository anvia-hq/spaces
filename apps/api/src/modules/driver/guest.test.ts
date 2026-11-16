/**
 * Guest-runtime tests: items that can only be checked inside a real microVM.
 *
 * Opt-in, because they need a hypervisor:
 *
 *   SPACES_IT=1 bun test                       # against `msb` on this machine
 *   SPACES_IT=1 SPACES_MSB_HOST=box bun test   # against another host over SSH
 *   SPACES_IT=1 SPACES_MSB_IMAGE=spaces/guest:ubuntu SPACES_IT_READY=1 bun test
 *
 * Everything else in this directory runs on the mock driver and always runs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MicrosandboxDriver } from "./microsandbox.ts";

const enabled = process.env.SPACES_IT === "1";
const readyImage = process.env.SPACES_IT_READY === "1";
const IMAGE = process.env.SPACES_MSB_IMAGE ?? "alpine";

const suite = enabled ? describe : describe.skip;

suite("guest runtime (real microVM)", () => {
  const driver = new MicrosandboxDriver({
    host: process.env.SPACES_MSB_HOST ?? "local",
    image: IMAGE,
  });

  const sandboxId = `bx_it${Date.now().toString(36).slice(-6)}`;
  let ref = "";

  beforeAll(async () => {
    const handle = await driver.create({
      sandboxId,
      type: "default",
      size: { vcpu: 4, memMib: 8192, diskGb: 51 },
    });
    ref = handle.ref;
  }, 120_000);

  afterAll(async () => {
    if (ref) await driver.destroy(sandboxId).catch(() => {});
  }, 60_000);

  test("commands run as the sandbox user (item 5)", async () => {
    const result = await driver.exec(ref, {
      command: "id -u; id -un; echo HOME=$HOME; pwd",
      timeoutSeconds: 30,
    });
    expect(result.exitCode).toBe(0);
    const [uid, name, home, pwd] = result.stdout.trim().split("\n");
    expect(uid).toBe("1000");
    expect(name).toBe("user");
    expect(home).toBe("HOME=/home/user");
    expect(pwd).toBe("/home/user");
  }, 60_000);

  test("files written through the API belong to the user, not root (item 5)", async () => {
    await driver.writeFile(ref, "/home/user/it-owned.txt", new TextEncoder().encode("x\n"));
    const result = await driver.exec(ref, {
      command: "stat -c '%U:%G' /home/user /home/user/it-owned.txt",
      timeoutSeconds: 30,
    });
    expect(result.stdout.trim().split("\n")).toEqual(["user:user", "user:user"]);
  }, 60_000);

  test("root is still available where the operator asked for it (item 5)", async () => {
    const result = await driver.exec(ref, {
      command: "id -u",
      timeoutSeconds: 30,
      runAs: "root",
    });
    expect(result.stdout.trim()).toBe("0");
  }, 60_000);

  test("a detached command is killed when timeoutSeconds elapses (item 6)", async () => {
    const started = await driver.startProcess(ref, {
      processId: "it-timeout",
      command: "sleep 60",
      cwd: "/home/user",
      timeoutSeconds: 2,
    });
    expect(started.pid).toBeGreaterThan(0);

    // Give the 2 s timeout room to fire, then check the group is gone.
    await Bun.sleep(5000);
    const state = await driver.processState(ref, "it-timeout");
    expect(state.running).toBe(false);
    expect(state.known).toBe(true);
    // Coreutils `timeout` reports 124, busybox reports 143 (128+SIGTERM).
    // Both mean "the deadline killed it", and the images differ.
    expect([124, 143]).toContain(state.exitCode ?? -1);
  }, 90_000);

  test("setsid + nohup escapes the timeout, as documented (item 6)", async () => {
    await driver.startProcess(ref, {
      processId: "it-escape",
      command: "setsid nohup sleep 45 >/dev/null 2>&1 &",
      cwd: "/home/user",
      timeoutSeconds: 2,
    });

    await Bun.sleep(5000);
    const state = await driver.processState(ref, "it-escape");
    // The wrapper exited (0) because it backgrounded, but the process it
    // started is still alive in its own session.
    const alive = await driver.exec(ref, {
      command: "pgrep -f 'sleep 45' >/dev/null && echo alive || echo gone",
      timeoutSeconds: 30,
    });
    expect(alive.stdout.trim()).toBe("alive");
    expect(state.running).toBe(false);
  }, 90_000);

  test("ps -o works, so GET /processes can parse it (item 4)", async () => {
    const result = await driver.exec(ref, {
      command: "ps -o pid,ppid,user,rss,args 2>/dev/null | tail -n +2 | head -3",
      timeoutSeconds: 30,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().length).toBeGreaterThan(0);
  }, 60_000);

  // The ready image's whole point: the tools are there on the first command,
  // with nothing installed at boot.
  test.skipIf(!readyImage)(
    "the ready image ships curl, git, ps and pgrep on first boot (item 4)",
    async () => {
      const result = await driver.exec(ref, {
        command:
          "for b in curl git ps pgrep ca-certificates; do " +
          'if [ "$b" = ca-certificates ]; then test -f /etc/ssl/certs/ca-certificates.crt || exit 1; ' +
          'else command -v "$b" >/dev/null || exit 1; fi; done; echo all-present',
        timeoutSeconds: 60,
      });
      expect(result.stdout.trim()).toBe("all-present");
    },
    90_000,
  );
});
