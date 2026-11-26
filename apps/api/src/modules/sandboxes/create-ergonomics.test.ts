import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  agentFor,
  eventually,
  FixtureDriver,
  OPERATOR_KEY,
  serveControlPlane,
} from "../../testing/control-plane.ts";

let server: { stop(force?: boolean): void };
let baseUrl = "";
let app: Awaited<ReturnType<typeof serveControlPlane>>["app"];
const agents: { stop(): Promise<void> }[] = [];

function call(method: string, path: string, json?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${OPERATOR_KEY}` };
  const init: RequestInit = { method, headers };

  if (json !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  return app.request(path, init);
}

beforeAll(async () => {
  const started = await serveControlPlane();
  server = started.server;
  baseUrl = started.url;
  app = started.app;
});

afterAll(async () => {
  for (const agent of agents) await agent.stop();

  server?.stop(true);
});

async function onlineFixtureRuntime(
  name: string,
  options: {
    driver?: FixtureDriver;
    portRange?: { start: number; end: number } | null;
  } = {},
) {
  const created = await call("POST", "/api/v1/runtimes", { name });
  expect(created.status).toBe(201);
  const { runtime, token } = (await created.json()) as {
    runtime: { id: string; name: string };
    token: string;
  };
  const driver = options.driver ?? new FixtureDriver();
  const { agent } = agentFor({
    url: baseUrl,
    token,
    driver,
    portRange: options.portRange,
  });
  agents.push(agent);
  await eventually(
    async () => {
      const res = await call("GET", `/api/v1/runtimes/${runtime.id}`);
      return ((await res.json()) as { runtime: { state: string } }).runtime.state;
    },
    (state) => state === "online",
  );
  return { runtime, driver };
}

describe("POST /sandboxes create ergonomics", () => {
  test("wait: true returns 201 with a ready sandbox", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      name: "sync-box",
      wait: true,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      ok: true;
      status: string;
      sandbox: { id: string; state: string; ip: string | null };
    };
    expect(body.ok).toBe(true);
    expect(body.status).toBe("ready");
    expect(body.sandbox.state).toBe("ready");
    expect(body.sandbox.ip).not.toBeNull();
  });

  test("hostedPorts are pre-published before boot with explicit: true and no restart on POST /host", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      name: "prehosted-box",
      wait: true,
      hostedPorts: [{ port: 4321, public: true, title: "api" }],
    });
    expect(res.status).toBe(201);
    const { sandbox } = (await res.json()) as { sandbox: { id: string } };

    const listed = (await (await call("GET", `/api/v1/sandboxes/${sandbox.id}/ports`)).json()) as {
      ports: { port: number; explicit: boolean; access: string; title: string | null }[];
    };
    expect(listed.ports).toHaveLength(1);
    expect(listed.ports[0]).toMatchObject({
      port: 4321,
      explicit: true,
      access: "public",
      title: "api",
    });

    const hosted = (await (
      await call("POST", `/api/v1/sandboxes/${sandbox.id}/host`, { port: 4321 })
    ).json()) as { restartRequired?: boolean; url: string };
    expect(hosted.restartRequired).toBeUndefined();
    expect(hosted.url).toContain(`/api/v1/_preview/${sandbox.id}/4321`);
  });

  test("create-time files are written before ready and invalid paths fail with 400", async () => {
    const bad = await call("POST", "/api/v1/sandboxes", {
      files: [{ path: "/etc/passwd", content: "nope" }],
    });
    expect(bad.status).toBe(400);

    const { runtime, driver } = await onlineFixtureRuntime(`files-${Date.now()}`);
    const res = await call("POST", "/api/v1/sandboxes", {
      name: "files-box",
      runtime: runtime.name,
      wait: true,
      files: [
        { path: "hello.txt", content: "hello world" },
        {
          path: "/tmp/raw.bin",
          content: Buffer.from([1, 2, 3]).toString("base64"),
          encoding: "base64",
        },
      ],
    });
    expect(res.status).toBe(201);

    const utf8 = driver.stored.get("/home/user/hello.txt");
    expect(utf8 ? new TextDecoder().decode(utf8) : null).toBe("hello world");
    expect(driver.stored.get("/tmp/raw.bin")).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("setupScript populates setupStatus and setupError on the sandbox", async () => {
    const okRes = await call("POST", "/api/v1/sandboxes", {
      name: "setup-ok",
      wait: true,
      setupScript: "echo ready",
    });
    expect(okRes.status).toBe(201);
    const { sandbox: okBox } = (await okRes.json()) as { sandbox: { id: string } };

    const okFinal = await eventually(
      async () =>
        (
          (await (await call("GET", `/api/v1/sandboxes/${okBox.id}`)).json()) as {
            sandbox: { setupStatus: string | null; setupError: string | null };
          }
        ).sandbox,
      (s) => s.setupStatus === "done",
    );
    expect(okFinal.setupError).toBeNull();

    const failRes = await call("POST", "/api/v1/sandboxes", {
      name: "setup-fail",
      wait: true,
      setupScript: "exit 1",
    });
    expect(failRes.status).toBe(201);
    const { sandbox: failBox } = (await failRes.json()) as { sandbox: { id: string } };

    const failFinal = await eventually(
      async () =>
        (
          (await (await call("GET", `/api/v1/sandboxes/${failBox.id}`)).json()) as {
            sandbox: { setupStatus: string | null; setupError: string | null };
          }
        ).sandbox,
      (s) => s.setupStatus === "failed",
    );
    expect(failFinal.setupError).toContain("exit 1");
  });

  test("wait: true returns 202 when waitTimeoutSeconds elapses before boot completes", async () => {
    class SlowDriver extends FixtureDriver {
      override async create(o: Parameters<FixtureDriver["create"]>[0]) {
        await Bun.sleep(1300);
        return await super.create(o);
      }
    }

    const { runtime } = await onlineFixtureRuntime(`slow-${Date.now()}`, {
      driver: new SlowDriver(),
    });
    const res = await call("POST", "/api/v1/sandboxes", {
      name: "slow-box",
      runtime: runtime.name,
      wait: true,
      waitTimeoutSeconds: 1,
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { sandbox: { id: string; state: string } };
    expect(body.sandbox.state).toBe("provisioning");

    await eventually(
      async () =>
        (
          (await (await call("GET", `/api/v1/sandboxes/${body.sandbox.id}`)).json()) as {
            sandbox: { state: string };
          }
        ).sandbox.state,
      (state) => state === "ready",
    );
  });

  test("post-boot files write failure destroys the VM, reports the path, and fails wait: true with 500", async () => {
    const destroyed: string[] = [];

    class FailingWriteDriver extends FixtureDriver {
      override async writeFile(): Promise<void> {
        throw new Error("guest operation failed: EIO");
      }

      override async destroy(sandboxId: string): Promise<void> {
        destroyed.push(sandboxId);
        await super.destroy(sandboxId);
      }
    }

    const { runtime } = await onlineFixtureRuntime(`fail-write-${Date.now()}`, {
      driver: new FailingWriteDriver(),
    });
    const res = await call("POST", "/api/v1/sandboxes", {
      name: "fail-files-box",
      runtime: runtime.name,
      wait: true,
      files: [{ path: "/home/user/boom.txt", content: "x" }],
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("/home/user/boom.txt");
    expect(destroyed.length).toBe(1);
    const errored = await call("GET", `/api/v1/sandboxes/${destroyed[0]!}`);
    expect(await errored.json()).toMatchObject({
      sandbox: { state: "error" },
    });
  });

  test("create-time files reject root directories, bad base64, whitespace bombs, and byte limits", async () => {
    const invalidFiles = [
      [{ path: "/home/user", content: "hi" }],
      [{ path: "/tmp", content: "hi" }],
      [{ path: "bad.bin", content: "not!valid!base64!!!", encoding: "base64" }],
      [{ path: "spaces.bin", content: " ".repeat(1024), encoding: "base64" }],
      [{ path: "big.txt", content: "a".repeat(5 * 1024 * 1024 + 1) }],
      [
        { path: "p1.txt", content: "a".repeat(4_500_000) },
        { path: "p2.txt", content: "a".repeat(4_500_000) },
        { path: "p3.txt", content: "a".repeat(4_500_000) },
        { path: "p4.txt", content: "a".repeat(4_500_000) },
        { path: "p5.txt", content: "a".repeat(4_500_000) },
      ],
    ];

    for (const files of invalidFiles) {
      const res = await call("POST", "/api/v1/sandboxes", { files });
      expect({ count: files.length, path: files[0]?.path, status: res.status }).toEqual({
        count: files.length,
        path: files[0]?.path,
        status: 400,
      });
    }
  });

  test("hostedPorts returns 501 on a runtime with port publishing disabled", async () => {
    const { runtime } = await onlineFixtureRuntime(`noports-${Date.now()}`, {
      portRange: null,
    });
    const res = await call("POST", "/api/v1/sandboxes", {
      runtime: runtime.name,
      hostedPorts: [{ port: 3000 }],
    });
    expect(res.status).toBe(501);
  });

  test("older runtime agent without networkPolicy capability fails closed with 409", async () => {
    class LegacyDriver extends FixtureDriver {
      override readonly capabilities = {
        exec: true,
        files: true,
        persistence: true,
      };
    }

    const { runtime } = await onlineFixtureRuntime(`legacy-${Date.now()}`, {
      driver: new LegacyDriver(),
    });
    const res = await call("POST", "/api/v1/sandboxes", {
      runtime: runtime.name,
      network: { mode: "deny" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("network_policy_unsupported");
  });
});
