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

async function onlineFixtureRuntime(name: string) {
  const created = await call("POST", "/api/v1/runtimes", { name });
  expect(created.status).toBe(201);
  const { runtime, token } = (await created.json()) as {
    runtime: { id: string; name: string };
    token: string;
  };
  const driver = new FixtureDriver();
  const { agent } = agentFor({ url: baseUrl, token, driver });
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
});
