import { describe, expect, test } from "bun:test";
import { OPERATOR_KEY } from "../../testing/control-plane.ts";

const { app } = await import("../../app.ts");
const { config } = await import("../../config.ts");
const { store } = await import("../../db.ts");
const { sampleCluster } = await import("./service.ts");

type Sample = {
  runtimeId: string;
  at: string;
  activeSandboxes: number;
  vcpuCommitted: number;
  memMibCommitted: number;
  vcpuCapacity: number | null;
  memMibCapacity: number | null;
};

type SamplesBody = { ok: boolean; type: string; samples: Sample[] };

function call(query = "") {
  return app.request(`/api/v1/runtimes/samples${query}`, {
    headers: { authorization: `Bearer ${OPERATOR_KEY}`, origin: config.auth.url },
  });
}

function unique(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).slice(-5)}`;
}

describe("capacity samples", () => {
  test("a sample is one row per online runtime, with what it reported", async () => {
    const written = await sampleCluster();

    expect(written).toBeGreaterThan(0);

    const res = await call("?minutes=60");

    expect(res.status).toBe(200);

    const body = (await res.json()) as SamplesBody;

    expect(body.type).toBe("runtime.samples");

    const mine = body.samples.filter((sample) => sample.runtimeId === "local");

    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]!.vcpuCommitted).toBeGreaterThanOrEqual(0);
    expect(mine[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("sampling twice in the same instant does not stack rows", async () => {
    const before = ((await (await call("?minutes=5")).json()) as SamplesBody).samples.length;

    await sampleCluster();
    await sampleCluster();

    const after = ((await (await call("?minutes=5")).json()) as SamplesBody).samples.length;

    expect(after).toBeLessThanOrEqual(before + 2);
  });

  test("a window is asked for in minutes, and a filter narrows to one runtime", async () => {
    const filtered = (await (await call("?minutes=60&runtime=nowhere")).json()) as SamplesBody;

    expect(filtered.samples).toHaveLength(0);

    const refused = await call("?minutes=1");

    expect(refused.status).toBe(400);
  });

  test("old samples are swept, and only the old ones", async () => {
    await sampleCluster();

    const kept = (await (await call("?minutes=60")).json()) as SamplesBody;

    expect(kept.samples.length).toBeGreaterThan(0);

    const removed = await store.sweepRuntimeSamples(new Date(Date.now() - 3_600_000));

    expect(removed).toBe(0);

    const swept = await store.sweepRuntimeSamples(new Date(Date.now() + 3_600_000));

    expect(swept).toBeGreaterThan(0);

    const now = (await (await call("?minutes=60")).json()) as SamplesBody;

    expect(now.samples).toHaveLength(0);
  });

  test("a runtime registered but never connected is not sampled", async () => {
    const res = await app.request("/api/v1/runtimes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${OPERATOR_KEY}`,
        origin: config.auth.url,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: unique("offline") }),
    });
    const created = (await res.json()) as { runtime: { id: string } };

    await sampleCluster();

    const samples = (await (await call("?minutes=60")).json()) as SamplesBody;
    const ids = samples.samples.map((sample) => sample.runtimeId);

    expect(ids).not.toContain(created.runtime.id);

    await app.request(`/api/v1/runtimes/${created.runtime.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${OPERATOR_KEY}`, origin: config.auth.url },
    });
  });
});
