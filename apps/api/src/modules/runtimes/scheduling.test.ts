import { afterAll, describe, expect, test } from "bun:test";
import { eventually } from "../../testing/control-plane.ts";
import { startFleet, type RuntimeView } from "../../testing/fleet.ts";

const fleet = await startFleet();
const { call, unique, online, createOn, runtimeView, sandboxState } = fleet;
const { config } = await import("../../config.ts");

afterAll(() => fleet.shutdown());

async function size(name: string, vcpu: number, memMib: number) {
  const res = await call("POST", "/api/v1/machine-sizes", { name, vcpu, memMib, diskGb: 5 });
  expect(res.status).toBe(201);
  return name;
}

const small = await size(unique("rs"), 1, 512);
const medium = await size(unique("rm"), 2, 2048);
const large = await size(unique("rl"), 4, 4096);
const huge = await size(unique("rh"), 64, 200_000);

async function alone<T>(keep: string[], body: () => Promise<T>): Promise<T> {
  const list = (await (await call("GET", "/api/v1/runtimes")).json()) as {
    runtimes: RuntimeView[];
  };
  const drained = list.runtimes.filter((r) => !keep.includes(r.id) && !r.draining);

  for (const runtime of drained)
    await call("PATCH", `/api/v1/runtimes/${runtime.id}`, { draining: true });

  try {
    return await body();
  } finally {
    for (const runtime of drained) {
      await call("PATCH", `/api/v1/runtimes/${runtime.id}`, { draining: false });
    }
  }
}

describe("placement follows headroom, not the number of sandboxes", () => {
  test("a big runtime keeps winning while a small empty one waits", async () => {
    const tiny = await online("tiny", { resources: { vcpu: 4, memMib: 4096 } });
    const big = await online("big", { resources: { vcpu: 32, memMib: 65536 } });

    const landed: string[] = [];

    await alone([tiny.id, big.id], async () => {
      for (let index = 0; index < 6; index += 1) {
        landed.push((await createOn(undefined, { type: medium })).runtimeId);
      }
    });

    expect(landed.every((id) => id === big.id)).toBe(true);
    expect((await runtimeView(tiny.id)).activeSandboxes).toBe(0);

    const view = await runtimeView(big.id);
    expect(view.committed).toEqual({ vcpu: 12, memMib: 12288 });
    expect(view.resources).toEqual({ vcpu: 32, memMib: 65536 });
  });

  test("once the big one is fuller than the small one would be, the small one is next", async () => {
    const tiny = await online("tiny2", { resources: { vcpu: 4, memMib: 4096 } });
    const big = await online("big2", { resources: { vcpu: 8, memMib: 8192 } });

    const [first, second] = await alone([tiny.id, big.id], async () => [
      await createOn(undefined, { type: medium }),
      await createOn(undefined, { type: medium }),
    ]);

    expect(new Set([first.runtimeId, second.runtimeId])).toEqual(new Set([big.id, tiny.id]));
  });

  test("memory can be the scarce dimension", async () => {
    const roomyCpu = await online("cpuheavy", { resources: { vcpu: 64, memMib: 2048 } });
    const roomyMem = await online("memheavy", { resources: { vcpu: 4, memMib: 65536 } });
    const placed = await alone([roomyCpu.id, roomyMem.id], () =>
      createOn(undefined, { type: medium }),
    );

    expect(placed.runtimeId).toBe(roomyMem.id);
    expect(placed.runtimeId).not.toBe(roomyCpu.id);
  });
});

describe("what does not fit is not placed", () => {
  test("an unpinned create skips a runtime that cannot hold it", async () => {
    const tiny = await online("fit-tiny", { resources: { vcpu: 4, memMib: 4096 } });
    const roomy = await online("fit-roomy", { resources: { vcpu: 4, memMib: 4096 } });
    await createOn(tiny.name, { type: medium });

    const placed = await alone([tiny.id, roomy.id], () => createOn(undefined, { type: large }));

    expect(placed.runtimeId).toBe(roomy.id);
  });

  test("a pinned create that does not fit is refused with the numbers", async () => {
    const edge = await online("pin-full", { resources: { vcpu: 4, memMib: 4096 } });
    await createOn(edge.name, { type: medium });

    const refused = await call("POST", "/api/v1/sandboxes", { runtime: edge.name, type: large });
    const body = (await refused.json()) as { code: string; message: string };

    expect(refused.status).toBe(403);
    expect(body.code).toBe("forbidden");
    expect(body.message).toContain(
      `runtime ${edge.name} has no room for 4 vCPU / 4096 MiB (free: 2 vCPU / 2048 MiB of 4 vCPU / 4096 MiB)`,
    );
  });

  test("a fork or restore pinned by its disk must fit where the disk is", async () => {
    const edge = await online("fork-full", { resources: { vcpu: 4, memMib: 4096 } });
    const parent = await createOn(edge.name, { type: medium });
    await createOn(edge.name, { type: medium });

    const fork = await call("POST", `/api/v1/sandboxes/${parent.id}/fork`, { type: medium });
    const body = (await fork.json()) as { message: string };

    expect(fork.status).toBe(403);
    expect(body.message).toContain("no room for 2 vCPU / 2048 MiB");
  });

  test("when nothing fits anywhere the answer lists each runtime's reason", async () => {
    const edge = await online("nothing", { resources: { vcpu: 4, memMib: 4096 } });

    await alone([edge.id], async () => {
      await call("PATCH", "/api/v1/runtimes/local", { draining: true });

      try {
        const res = await call("POST", "/api/v1/sandboxes", { type: huge });
        const body = (await res.json()) as { code: string; message: string };

        expect(res.status).toBe(503);
        expect(body.code).toBe("runtime_unavailable");
        expect(body.message).toContain(
          `${edge.name}: runtime ${edge.name} has no room for 64 vCPU`,
        );
        expect(body.message).toContain("local: runtime local is draining");
      } finally {
        await call("PATCH", "/api/v1/runtimes/local", { draining: false });
      }
    });
  });

  test("a runtime that reported nothing is the fallback, chosen only when no measured one fits", async () => {
    const measured = await online("measured", { resources: { vcpu: 4, memMib: 4096 } });

    await alone([measured.id, "local"], async () => {
      const fits = await createOn(undefined, { type: medium });
      expect(fits.runtimeId).toBe(measured.id);

      const mock = await createOn(undefined, { type: huge });
      expect(mock.runtimeId).toBe("local");
    });
  });
});

describe("resuming needs room too", () => {
  test("a stopped sandbox frees its share, and cannot come back into a full runtime", async () => {
    const edge = await online("resume", { resources: { vcpu: 4, memMib: 4096 } });
    const first = await createOn(edge.name, { type: large });

    expect((await runtimeView(edge.id)).committed).toEqual({ vcpu: 4, memMib: 4096 });

    const stopped = await call("POST", `/api/v1/sandboxes/${first.id}/stop`, {});
    expect(stopped.status).toBe(200);
    expect((await runtimeView(edge.id)).committed).toEqual({ vcpu: 0, memMib: 0 });

    const filler = await createOn(edge.name, { type: large });

    const refused = await call("POST", `/api/v1/sandboxes/${first.id}/resume`, {});
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { message: string }).message).toContain("no room for 4 vCPU");
    expect(await sandboxState(first.id)).toBe("archived");

    await call("DELETE", `/api/v1/sandboxes/${filler.id}`);

    const resumed = await call("POST", `/api/v1/sandboxes/${first.id}/resume`, {});
    expect(resumed.status).toBe(202);
    await eventually(
      () => sandboxState(first.id),
      (state) => state === "ready",
    );
  });

  test("resuming into a bigger size is checked against that size", async () => {
    const edge = await online("grow", { resources: { vcpu: 4, memMib: 4096 } });
    const made = await createOn(edge.name, { type: small });
    await call("POST", `/api/v1/sandboxes/${made.id}/stop`, {});
    await createOn(edge.name, { type: medium });

    const refused = await call("POST", `/api/v1/sandboxes/${made.id}/resume`, { type: large });
    expect(refused.status).toBe(403);

    const fits = await call("POST", `/api/v1/sandboxes/${made.id}/resume`, { type: small });
    expect(fits.status).toBe(202);
  });
});

describe("overcommit", () => {
  test("a factor above one lets a runtime take more than it reported", async () => {
    const edge = await online("over", { resources: { vcpu: 4, memMib: 4096 } });
    await createOn(edge.name, { type: large });

    const strict = await call("POST", "/api/v1/sandboxes", { runtime: edge.name, type: large });
    expect(strict.status).toBe(403);

    Object.assign(config.runtime, { overcommit: 2 });

    try {
      const lenient = await createOn(edge.name, { type: large });
      expect(lenient.res.status).toBe(202);
      expect((await runtimeView(edge.id)).committed).toEqual({ vcpu: 8, memMib: 8192 });
    } finally {
      Object.assign(config.runtime, { overcommit: 1 });
    }
  });
});

describe("what the control plane shows", () => {
  test("an agent that reports nothing has no resources and is never refused for room", async () => {
    const quiet = await online("quiet-res");
    const view = await runtimeView(quiet.id);

    expect(view.resources).toBeNull();

    const placed = await createOn(quiet.name, { type: huge });
    expect(placed.res.status).toBe(202);
  });

  test("the numbers an agent reports are kept, and replaced when it reconnects with new ones", async () => {
    const edge = await online("report", { resources: { vcpu: 6, memMib: 6144 } });
    expect((await runtimeView(edge.id)).resources).toEqual({ vcpu: 6, memMib: 6144 });

    await edge.agent.stop();
    const again = (await import("../../testing/control-plane.ts")).agentFor({
      url: fleet.url,
      token: edge.token,
      resources: { vcpu: 12, memMib: 12288 },
    });
    fleet.track(() => again.agent.stop());
    await again.agent.connected;

    await eventually(
      () => runtimeView(edge.id),
      (view) => view.state === "online" && view.resources?.vcpu === 12,
    );
  });
});
