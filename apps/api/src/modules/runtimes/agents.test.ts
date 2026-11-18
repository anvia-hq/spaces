import { afterAll, describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION } from "@spaces/shared/runtime";
import { FixtureDriver, agentFor, eventually } from "../../testing/control-plane.ts";
import { startFleet, type RuntimeView } from "../../testing/fleet.ts";

const fleet = await startFleet();
const { app, url, unique, call, register, runtimeView, online, sandboxState, createOn } = fleet;
const { sweepLiveness } = await import("./session.ts");
const { isRuntimeReachable } = await import("./service.ts");

afterAll(() => fleet.shutdown());

describe("an agent joins and leaves", () => {
  test("it registers with what it advertised and goes offline when it stops", async () => {
    const edge = await online("join", {
      publicHost: "edge.test",
      portRange: { start: 23100, end: 23110 },
    });
    const view = await runtimeView(edge.id);

    expect(view).toMatchObject({
      state: "online",
      driver: "mock",
      publicHost: "edge.test",
      agentVersion: "test",
    });
    expect(isRuntimeReachable(edge.id)).toBe(true);

    await edge.agent.stop();

    await eventually(
      () => runtimeView(edge.id),
      (next) => next.state === "offline",
    );
    expect(isRuntimeReachable(edge.id)).toBe(false);
  });

  test("an unknown token is refused before any socket opens", async () => {
    const res = await fetch(`${url}/runtime/connect`, {
      headers: { authorization: "Bearer spr_not-a-real-token" },
    });

    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("unauthorized");

    const nothing = await fetch(`${url}/runtime/connect`);
    expect(nothing.status).toBe(401);
  });

  test("an agent with a bad token never becomes connected", async () => {
    const { agent } = agentFor({ url, token: "spr_wrong" });
    fleet.track(() => agent.stop());

    await Bun.sleep(250);
    expect(agent.isConnected()).toBe(false);
  });

  test("a protocol mismatch is refused with the reason, and the runtime stays offline", async () => {
    const { id, token } = await register(unique("proto"));
    const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
      const socket = new WebSocket(`${url.replace("http", "ws")}/runtime/connect`, {
        headers: { authorization: `Bearer ${token}` },
      });
      socket.addEventListener("open", () =>
        socket.send(
          JSON.stringify({
            t: "hello",
            protocol: PROTOCOL_VERSION + 998,
            agentVersion: "future",
            driver: "mock",
            capabilities: { exec: true, files: true, persistence: true },
            portRange: null,
            portBind: "127.0.0.1",
            publicHost: null,
          }),
        ),
      );
      socket.addEventListener("close", (event) =>
        resolve({ code: event.code, reason: event.reason }),
      );
    });

    expect(closed.code).toBe(1008);
    expect(closed.reason).toContain("protocol mismatch");
    expect((await runtimeView(id)).state).toBe("offline");
  });

  test("a socket that speaks before hello, or not in frames, is dropped", async () => {
    const { token } = await register(unique("rude"));
    const closeOf = (message: string) =>
      new Promise<number>((resolve) => {
        const socket = new WebSocket(`${url.replace("http", "ws")}/runtime/connect`, {
          headers: { authorization: `Bearer ${token}` },
        });
        socket.addEventListener("open", () => socket.send(message));
        socket.addEventListener("close", (event) => resolve(event.code));
      });

    expect(await closeOf("not json")).toBe(1003);
    expect(await closeOf(JSON.stringify({ t: "heartbeat" }))).toBe(1002);
  });

  test("a second connection with the same token replaces the first", async () => {
    const first = await online("swap");
    const second = agentFor({ url, token: first.token });
    fleet.track(() => second.agent.stop());
    await second.agent.connected;

    await eventually(
      () => first.agent.isConnected(),
      (connected) => !connected,
    );
    expect(second.agent.isConnected()).toBe(true);
    await first.agent.stop();
    await Bun.sleep(100);
    expect((await runtimeView(first.id)).state).toBe("online");

    const made = await createOn(first.name);
    expect(made.runtimeId).toBe(first.id);
  });
});

describe("a sandbox on an agent runtime", () => {
  test("lives its whole life over the wire and stays pinned", async () => {
    const edge = await online("life");
    const made = await createOn(edge.name, { name: "wire-life" });

    expect(made.res.status).toBe(202);
    expect(made.runtimeId).toBe(edge.id);

    const ran = await call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "uname" });
    expect(ran.status).toBe(200);
    expect(((await ran.json()) as { stdout: string }).stdout).toContain("Linux spaces-mock");

    const stopped = await call("POST", `/api/v1/sandboxes/${made.id}/stop`, {});
    expect(stopped.status).toBe(200);
    expect(await sandboxState(made.id)).toBe("archived");

    const resumed = await call("POST", `/api/v1/sandboxes/${made.id}/resume`, {});
    expect(resumed.status).toBe(202);
    await eventually(
      () => sandboxState(made.id),
      (state) => state === "ready",
    );

    const forked = await call("POST", `/api/v1/sandboxes/${made.id}/fork`, {});
    const fork = ((await forked.json()) as { sandbox: { id: string; runtimeId: string } }).sandbox;
    expect(fork.runtimeId).toBe(edge.id);

    const removed = await call("DELETE", `/api/v1/sandboxes/${made.id}`);
    expect(removed.status).toBe(200);
  });

  test("a snapshot is pinned to its runtime, and so is a sandbox created from it", async () => {
    const edge = await online("snap");
    const other = await online("snapother");
    const made = await createOn(edge.name);
    const name = unique("saved");

    const saved = await call("POST", "/api/v1/saved-snapshots", { sandboxId: made.id, name });
    expect(saved.status).toBe(202);
    const status = await eventually(
      async () =>
        (
          (await (await call("GET", `/api/v1/saved-snapshots/${name}`)).json()) as {
            snapshot: { status: string };
          }
        ).snapshot.status,
      (value) => value !== "saving",
    );
    expect(status).toBe("ready");

    const there = await createOn(undefined, { from: name });
    expect(there.runtimeId).toBe(edge.id);

    const elsewhere = await call("POST", "/api/v1/sandboxes", { from: name, runtime: other.name });
    expect(elsewhere.status).toBe(400);
    expect(((await elsewhere.json()) as { message: string }).message).toContain(
      `lives on runtime ${edge.name}`,
    );

    const matching = await createOn(edge.name, { from: name });
    expect(matching.runtimeId).toBe(edge.id);
  });

  test("errors keep their meaning: a driver refusal is a 501 here too", async () => {
    const edge = await online("refuse");
    const remote = await createOn(edge.name);
    const local = await createOn("local");

    const viaWire = await call("GET", `/api/v1/sandboxes/${remote.id}/files/list?path=/home/user`);
    const direct = await call("GET", `/api/v1/sandboxes/${local.id}/files/list?path=/home/user`);

    expect(viaWire.status).toBe(direct.status);
    expect(viaWire.status).toBe(501);
    expect(((await viaWire.json()) as { code: string }).code).toBe("provider_not_configured");
  });

  test("a payload larger than the socket's default limit crosses", async () => {
    const { driverFor } = await import("../driver/service.ts");
    const driver = new FixtureDriver();
    const edge = await online("big", { driver });
    const big = new Uint8Array(20 * 1024 * 1024);

    for (let index = 0; index < big.length; index += 4096) big[index] = (index / 4096) % 251;

    const remote = driverFor(edge.id);
    await remote.writeFile("ref", "/home/user/big.bin", big);

    expect(driver.stored.get("/home/user/big.bin")?.byteLength).toBe(big.byteLength);

    const back = await remote.readFile("ref", "/home/user/big.bin");
    expect(back.byteLength).toBe(big.byteLength);
    expect(Buffer.compare(back, big)).toBe(0);
  });

  test("a payload over the frame ceiling is refused cleanly and the connection survives", async () => {
    const { driverFor } = await import("../driver/service.ts");
    const driver = new FixtureDriver();
    const edge = await online("toobig", { driver });
    const remote = driverFor(edge.id);
    const tooBig = new Uint8Array(100 * 1024 * 1024);

    const refused = await remote.writeFile("ref", "/home/user/huge.bin", tooBig).then(
      () => null,
      (error: unknown) => error,
    );

    expect(refused).toBeInstanceOf(Error);
    expect((refused as Error).message).toContain("file_too_large");
    expect(driver.stored.has("/home/user/huge.bin")).toBe(false);

    await remote.writeFile("ref", "/home/user/small.bin", new Uint8Array([1, 2, 3]));
    expect(driver.stored.get("/home/user/small.bin")).toEqual(new Uint8Array([1, 2, 3]));
    expect(edge.agent.isConnected()).toBe(true);
  });

  test("bytes survive the wire in both directions", async () => {
    const driver = new FixtureDriver();
    const edge = await online("bytes", { driver });
    const made = await createOn(edge.name);
    const raw = new Uint8Array([0, 1, 2, 253, 254, 255, 128, 10, 13]);
    const path = "/home/user/blob.bin";

    const put = await call("PUT", `/api/v1/sandboxes/${made.id}/files`, {
      path,
      content: Buffer.from(raw).toString("base64"),
      encoding: "base64",
    });
    expect(put.status).toBe(200);
    expect(driver.stored.get(path)).toEqual(raw);

    const read = await call(
      "GET",
      `/api/v1/sandboxes/${made.id}/files?path=${path}&encoding=base64`,
    );
    const body = (await read.json()) as { content: string; size: number };

    expect(new Uint8Array(Buffer.from(body.content, "base64"))).toEqual(raw);
    expect(body.size).toBe(raw.byteLength);
  });
});

describe("previews go through the control plane", () => {
  async function hosted(driver: FixtureDriver) {
    const edge = await online("prev", { driver, portRange: { start: 23200, end: 23210 } });
    const made = await createOn(edge.name);
    const res = await call("POST", `/api/v1/sandboxes/${made.id}/host`, {
      port: 3000,
      public: true,
    });
    expect(res.status).toBe(200);
    const { url: previewUrl } = (await res.json()) as { url: string };

    return { edge, made, path: new URL(previewUrl).pathname };
  }

  test("a streamed answer arrives whole, with its status and headers", async () => {
    const driver = new FixtureDriver();
    const { path } = await hosted(driver);

    const res = await app.request(`${path}/deep/page?x=1`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        authorization: "Bearer leak",
        "x-keep": "1",
      },
      body: new Uint8Array([1, 2, 3]),
    });

    expect(res.status).toBe(201);
    expect(res.headers.get("x-fixture")).toBe("yes");
    expect(await res.text()).toBe("alpha-beta-gamma");

    const seen = driver.proxied[0]!;
    expect(seen.method).toBe("POST");
    expect(seen.path).toBe("/deep/page?x=1");
    expect(seen.body).toEqual(new Uint8Array([1, 2, 3]));
    expect(seen.hostPort).toBeGreaterThanOrEqual(23200);
    expect(seen.hostPort).toBeLessThanOrEqual(23210);

    const headers = Object.fromEntries(seen.headers);
    expect(headers["x-keep"]).toBe("1");
    expect(headers.authorization).toBeUndefined();
  });

  test("a client that hangs up cancels the stream on the runtime", async () => {
    const driver = new FixtureDriver();
    driver.chunks = Array.from({ length: 400 }, (_, index) => `chunk-${index};`);
    const { path } = await hosted(driver);

    const res = await app.request(path);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();

    await eventually(
      () => driver.cancelledStreams,
      (count) => count === 1,
    );
  });

  test("host ports are allocated from each runtime's own range", async () => {
    const driver = new FixtureDriver();
    const { made } = await hosted(driver);
    const again = await call("POST", `/api/v1/sandboxes/${made.id}/host`, { port: 4000 });
    const ports = (await (await call("GET", `/api/v1/sandboxes/${made.id}/ports`)).json()) as {
      ports: { hostPort: number }[];
    };
    const taken = ports.ports.map((port) => port.hostPort);

    expect(again.status).toBe(200);
    expect(new Set(taken).size).toBe(2);
    expect(taken.every((port) => port >= 23200 && port <= 23210)).toBe(true);

    const local = await createOn("local");
    await call("POST", `/api/v1/sandboxes/${local.id}/host`, { port: 3000 });
    const localPorts = (await (
      await call("GET", `/api/v1/sandboxes/${local.id}/ports`)
    ).json()) as {
      ports: { hostPort: number }[];
    };
    expect(localPorts.ports[0]!.hostPort).toBeGreaterThanOrEqual(22000);
    expect(localPorts.ports[0]!.hostPort).toBeLessThan(23000);
  });

  test("unhosting forgets the port on the runtime", async () => {
    const driver = new FixtureDriver();
    const { made } = await hosted(driver);
    const removed = await call("DELETE", `/api/v1/sandboxes/${made.id}/host/3000`);

    expect(removed.status).toBe(200);
    expect(((await driver.listeningPorts()) ?? []).length).toBe(0);
  });
});

describe("scheduling", () => {
  test("an unpinned create lands on the open runtime with the fewest active sandboxes", async () => {
    await online("sched-a");
    await online("sched-b");
    const list = (await (await call("GET", "/api/v1/runtimes")).json()) as {
      runtimes: RuntimeView[];
    };
    const open = list.runtimes.filter((runtime) => runtime.state === "online" && !runtime.draining);
    const expected = [...open].sort(
      (a, b) => a.activeSandboxes - b.activeSandboxes || a.name.localeCompare(b.name),
    )[0]!;

    const made = await createOn(undefined);

    expect(made.runtimeId).toBe(expected.id);
  });

  test("a draining runtime takes nothing new but keeps what it has", async () => {
    const edge = await online("drain");
    const made = await createOn(edge.name);
    await call("PATCH", `/api/v1/runtimes/${edge.id}`, { draining: true });

    const refused = await call("POST", "/api/v1/sandboxes", { runtime: edge.name });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { message: string }).message).toContain("draining");

    const ran = await call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "uname" });
    expect(ran.status).toBe(200);

    const unpinned = await createOn(undefined);
    expect(unpinned.runtimeId).not.toBe(edge.id);

    const fork = await call("POST", `/api/v1/sandboxes/${made.id}/fork`, {});
    expect(fork.status).toBe(403);
  });

  test("a runtime at its cap is skipped, and pinning to it says why", async () => {
    const edge = await online("cap", { cap: 1 });
    await createOn(edge.name);

    const refused = await call("POST", "/api/v1/sandboxes", { runtime: edge.name });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { message: string }).message).toContain("limit of 1");

    for (let index = 0; index < 3; index += 1) {
      expect((await createOn(undefined)).runtimeId).not.toBe(edge.id);
    }
  });

  test("a runtime that is not there is a 404, an offline one a retryable 503", async () => {
    const missing = await call("POST", "/api/v1/sandboxes", { runtime: "no-such-runtime" });
    expect(missing.status).toBe(404);

    const edge = await online("down");
    await edge.agent.stop();
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "offline",
    );

    const pinned = await call("POST", "/api/v1/sandboxes", { runtime: edge.name });
    expect(pinned.status).toBe(503);
    expect(((await pinned.json()) as { code: string }).code).toBe("runtime_unavailable");
  });

  test("with every runtime unavailable the answer lists each reason", async () => {
    await call("PATCH", "/api/v1/runtimes/local", { draining: true });

    try {
      const list = (await (await call("GET", "/api/v1/runtimes")).json()) as {
        runtimes: RuntimeView[];
      };

      for (const runtime of list.runtimes.filter((entry) => entry.id !== "local")) {
        await call("PATCH", `/api/v1/runtimes/${runtime.id}`, { draining: true });
      }

      const res = await call("POST", "/api/v1/sandboxes", {});
      const body = (await res.json()) as { code: string; message: string };

      expect(res.status).toBe(503);
      expect(body.code).toBe("runtime_unavailable");
      expect(body.message).toContain("local: runtime local is draining");

      for (const runtime of list.runtimes.filter((entry) => entry.id !== "local")) {
        await call("PATCH", `/api/v1/runtimes/${runtime.id}`, { draining: false });
      }
    } finally {
      await call("PATCH", "/api/v1/runtimes/local", { draining: false });
    }
  });
});

describe("when a runtime is away", () => {
  test("its sandboxes stay readable, writes answer 503, and nothing is marked failed", async () => {
    const edge = await online("away");
    const made = await createOn(edge.name);
    await edge.agent.stop();
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "offline",
    );

    expect((await call("GET", `/api/v1/sandboxes/${made.id}`)).status).toBe(200);

    const attempts = [
      call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "uname" }),
      call("POST", `/api/v1/sandboxes/${made.id}/stop`, {}),
      call("DELETE", `/api/v1/sandboxes/${made.id}`),
      call("POST", "/api/v1/saved-snapshots", { sandboxId: made.id, name: unique("away") }),
      call("POST", `/api/v1/sandboxes/${made.id}/fork`, {}),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe("runtime_unavailable");
    }

    expect(await sandboxState(made.id)).toBe("ready");

    const removal = await call("DELETE", `/api/v1/runtimes/${edge.id}`);
    expect(removal.status).toBe(409);
    expect(((await removal.json()) as { message: string }).message).toContain(
      "still holds 1 sandbox",
    );
  });

  test("it picks up where it left off when the agent returns", async () => {
    const edge = await online("back");
    const made = await createOn(edge.name);
    await edge.agent.stop();
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "offline",
    );

    const again = agentFor({ url, token: edge.token, driver: edge.driver });
    fleet.track(() => again.agent.stop());
    await again.agent.connected;
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "online",
    );

    const ran = await call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "uname" });
    expect(ran.status).toBe(200);
  });

  test("a call in flight fails fast when the runtime drops", async () => {
    class Slow extends FixtureDriver {
      release: () => void = () => undefined;

      override async exec(): Promise<never> {
        await new Promise<void>((resolve) => {
          this.release = resolve;
        });
        throw new Error("released");
      }
    }
    const driver = new Slow();
    const edge = await online("inflight", { driver });
    const made = await createOn(edge.name);

    const pending = call("POST", `/api/v1/sandboxes/${made.id}/commands`, { command: "sleep 99" });
    await Bun.sleep(100);
    await edge.agent.stop();
    const res = await pending;

    expect(res.status).toBe(503);
    expect(((await res.json()) as { message: string }).message).toContain("went offline");
    driver.release();
  });

  test("silence is noticed: a stale heartbeat takes the runtime offline, and the agent reconnects", async () => {
    const edge = await online("quiet");
    const before = (await runtimeView(edge.id)).connectedAt;
    await Bun.sleep(10);
    const swept = sweepLiveness(Date.now() + 60_000);

    expect(swept).toContain(edge.id);
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "online" && view.connectedAt !== before,
    );
    expect(edge.agent.isConnected()).toBe(true);
  });

  test("rotating the token cuts off the old agent and admits the new one", async () => {
    const edge = await online("rotate");
    const rotated = await call("POST", `/api/v1/runtimes/${edge.id}/token`);
    const { token } = (await rotated.json()) as { token: string };

    await eventually(
      () => edge.agent.isConnected(),
      (connected) => !connected,
    );
    const refused = await fetch(`${url}/runtime/connect`, {
      headers: { authorization: `Bearer ${edge.token}` },
    });
    expect(refused.status).toBe(401);

    const fresh = agentFor({ url, token });
    fleet.track(() => fresh.agent.stop());
    await fresh.agent.connected;
    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "online",
    );
  });

  test("deleting a runtime disconnects its agent", async () => {
    const edge = await online("delete");
    const removed = await call("DELETE", `/api/v1/runtimes/${edge.id}`);

    expect(removed.status).toBe(200);
    await eventually(
      () => edge.agent.isConnected(),
      (connected) => !connected,
    );
    expect((await call("GET", `/api/v1/runtimes/${edge.id}`)).status).toBe(404);
  });
});
