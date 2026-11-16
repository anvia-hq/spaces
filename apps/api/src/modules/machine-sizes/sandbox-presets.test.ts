/**
 * Sandbox creation reads presets from the operator's table, not from a constant.
 *
 * Separate file because it creates and waits for sandboxes while the suite
 * clears the database between files: every request here is issued after this
 * file's own import of the app, which applies the migrations.
 */
import { describe, expect, test } from "bun:test";

const { app } = await import("../../app.ts");
const { MockDriver } = await import("../driver/mock.ts");

const OPERATOR = "test_key";

async function call(method: string, path: string, json?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${OPERATOR}` };

  if (json !== undefined) headers["content-type"] = "application/json";

  return app.request(path, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

async function createPreset(name: string, vcpu = 3, memMib = 6144, diskGb = 61) {
  return call("POST", "/api/v1/machine-sizes", { name, vcpu, memMib, diskGb });
}

async function createSandbox(json: Record<string, unknown>) {
  const res = await call("POST", "/api/v1/sandboxes", json);
  return { res, body: (await res.json()) as Record<string, unknown> };
}

async function waitFor(id: string, states: string[], timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";

  while (Date.now() < deadline) {
    const res = await call("GET", `/api/v1/sandboxes/${id}`);
    const body = (await res.json()) as { sandbox: { state: string } };
    last = body.sandbox.state;

    if (states.includes(last)) return last;

    await Bun.sleep(25);
  }

  throw new Error(`sandbox ${id} stuck in ${last}`);
}

describe("sandboxes use the table", () => {
  test("create at a preset the operator just added, and the driver gets its numbers", async () => {
    await createPreset("nine-core", 9, 18432, 131);

    const original = MockDriver.prototype.exec;
    const reported: string[] = [];
    MockDriver.prototype.exec = async function (
      this: unknown,
      ref: string,
      request: { command: string },
    ) {
      const result = await original.call(this as never, ref, request as never);

      if (request.command.trim() === "nproc") reported.push(result.stdout.trim());

      return result;
    };

    try {
      const { res, body } = await createSandbox({ type: "nine-core", ttlSeconds: 60 });
      expect(res.status).toBe(202);
      const id = (body.sandbox as { id: string }).id;
      await waitFor(id, ["ready"]);

      const run = await call("POST", `/api/v1/sandboxes/${id}/commands`, { command: "nproc" });
      expect(((await run.json()) as { stdout: string }).stdout.trim()).toBe("9");
      expect(reported).toEqual(["9"]);
    } finally {
      MockDriver.prototype.exec = original;
    }
  });

  test("an unknown type is an honest 404, not a silent default", async () => {
    const { res, body } = await createSandbox({ type: "enormous", ttlSeconds: 60 });
    expect(res.status).toBe(404);
    expect(body.code).toBe("not_found");
    expect(String(body.message)).toContain("enormous");
  });

  test("create without a type still lands on default", async () => {
    const { res, body } = await createSandbox({ ttlSeconds: 60 });
    expect(res.status).toBe(202);
    expect((body.sandbox as { type: string }).type).toBe("default");
  });

  test("a retired preset is refused for new machines, and its sandboxes stay readable", async () => {
    await createPreset("fading", 2, 2048, 20);
    const { body } = await createSandbox({ type: "fading", ttlSeconds: 60 });
    const id = (body.sandbox as { id: string }).id;
    await waitFor(id, ["ready"]);

    await call("DELETE", "/api/v1/machine-sizes/fading");

    const refused = await createSandbox({ type: "fading", ttlSeconds: 60 });
    expect(refused.res.status).toBe(404);
    expect(refused.body.code).toBe("not_found");
    expect(String(refused.body.message)).toContain("retired");

    const existing = await call("GET", `/api/v1/sandboxes/${id}`);
    expect(existing.status).toBe(200);
    expect(((await existing.json()) as { sandbox: { type: string } }).sandbox.type).toBe("fading");

    const limits = await call("GET", "/api/v1/limits");
    const allowed = ((await limits.json()) as { limits: { allowedTypes: string[] } }).limits
      .allowedTypes;
    expect(allowed).not.toContain("fading");
  });

  test("fork may not move to a retired preset", async () => {
    await createPreset("gone", 2, 2048, 20);
    const { body } = await createSandbox({ type: "default", ttlSeconds: 60 });
    const id = (body.sandbox as { id: string }).id;
    await waitFor(id, ["ready"]);

    await call("DELETE", "/api/v1/machine-sizes/gone");

    const res = await call("POST", `/api/v1/sandboxes/${id}/fork`, { type: "gone" });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("not_found");
  });
});
