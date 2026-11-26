import { describe, expect, test } from "bun:test";

const { app } = await import("../src/app.ts");

const KEY = "test_key";

function call(
  method: string,
  path: string,
  options: { json?: unknown; rawBody?: string | null; contentType?: string | null } = {},
) {
  const headers: Record<string, string> = { authorization: `Bearer ${KEY}` };
  const init: RequestInit = { method, headers };

  if (options.json !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.json);
  } else if (options.rawBody !== undefined) {
    if (options.rawBody !== null) init.body = options.rawBody;

    const ct = options.contentType === undefined ? "application/json" : options.contentType;

    if (ct !== null) headers["content-type"] = ct;
  }

  return app.request(path, init);
}

const post = (path: string, json?: unknown) => call("POST", path, { json });
const get = (path: string) => call("GET", path);

async function createSandbox(json: Record<string, unknown> = {}) {
  const res = await post("/api/v1/sandboxes", json);
  const body = (await res.json()) as { sandbox: { id: string; name: string } };
  return { res, body, id: body.sandbox?.id };
}

async function waitFor(id: string, states: string[], timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  let last = "";
  while (Date.now() < deadline) {
    const res = await get(`/api/v1/sandboxes/${id}`);
    const body = (await res.json()) as { sandbox: { state: string } };
    last = body.sandbox?.state;

    if (states.includes(last)) return last;

    await Bun.sleep(25);
  }
  throw new Error(`sandbox ${id} stuck in ${last}, wanted ${states.join("|")}`);
}

describe("POST /sandboxes request contract", () => {
  test("every supported field is accepted", async () => {
    const { res, body } = await createSandbox({
      type: "default",
      ttlSeconds: 600,
      labels: { session: "abc" },
      env: { FOO: "bar" },
      name: "full-schema",
      setupScript: "echo setup",
      hostedPorts: [{ port: 3000, public: true, title: "dev" }],
      files: [{ path: "/home/user/boot.txt", content: "hi", encoding: "utf8" }],
    });

    expect(res.status).toBe(202);
    expect(body.sandbox.name).toBe("full-schema");
  });

  test("removed SaaS compatibility fields and unknown fields are rejected", async () => {
    const rejected: Record<string, unknown>[] = [
      { notAThing: 1 },
      { noEnv: true },
      { visibility: "shared" },
      { environment: "base" },
      { snapshots: false },
      { monitoring: false },
      { failFast: true },
      { count: 2 },
      { org: "acme" },
      { teamId: "team_1" },
      { ttlSeconds: "infinite" },
    ];
    for (const payload of rejected) {
      const res = await post("/api/v1/sandboxes", payload);
      const body = (await res.json()) as { code: string };
      expect({ payload, status: res.status, code: body.code }).toEqual({
        payload,
        status: 400,
        code: "invalid_body",
      });
    }
  });

  test("ttlSeconds null disables auto-stop", async () => {
    const { res, id } = await createSandbox({ ttlSeconds: null });
    expect(res.status).toBe(202);
    const res2 = await get(`/api/v1/sandboxes/${id}`);
    const sandbox = ((await res2.json()) as { sandbox: { archiveAfter: string | null } }).sandbox;
    expect(sandbox.archiveAfter).toBeNull();
  });

  test("an unresolvable 'from' is a 404, not a silent cold boot", async () => {
    const res = await post("/api/v1/sandboxes", { from: "no-such-snapshot" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("snapshot_not_found");
  });

  test("removed routes return standard 404 instead of 501 or dummy data", async () => {
    const { id } = await createSandbox();
    const removed: [string, string][] = [
      ["POST", `/api/v1/sandboxes/${id}/desktop`],
      ["POST", `/api/v1/sandboxes/${id}/prompt`],
      ["POST", `/api/v1/sandboxes/${id}/share`],
      ["GET", `/api/v1/sandboxes/${id}/ai-usage`],
      ["GET", "/api/v1/named-snapshots"],
      ["GET", "/api/v1/saved-snapshots/base/shares"],
    ];
    for (const [method, path] of removed) {
      const res = await call(method, path, method === "POST" ? { json: {} } : {});
      expect({ method, path, status: res.status }).toEqual({ method, path, status: 404 });
    }
  });
});

describe("POST /sandboxes/{id}/resume request contract", () => {
  async function archivedSandbox() {
    const { id } = await createSandbox({ ttlSeconds: 600, env: { INITIAL: "1" } });
    await waitFor(id, ["ready", "running"]);
    const stop = await post(`/api/v1/sandboxes/${id}/stop`, {});
    expect([200, 202]).toContain(stop.status);
    await waitFor(id, ["archived"]);
    return id;
  }

  test("ttlSeconds is accepted and resets the auto-stop timer", async () => {
    const id = await archivedSandbox();

    const before = Date.now();
    const res = await post(`/api/v1/sandboxes/${id}/resume`, { ttlSeconds: 7200 });
    expect(res.status).toBe(202);

    await waitFor(id, ["ready", "running"]);
    const body = (await (await get(`/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { archiveAfter: string | null };
    };
    expect(body.sandbox.archiveAfter).not.toBeNull();

    const deadline = new Date(body.sandbox.archiveAfter!).getTime();
    const offset = (deadline - before) / 1000;
    expect(offset).toBeGreaterThan(7200 - 30);
    expect(offset).toBeLessThan(7200 + 30);
  });

  test("type, name, and env are applied on resume", async () => {
    const id = await archivedSandbox();
    const res = await post(`/api/v1/sandboxes/${id}/resume`, {
      type: "small",
      name: "renamed-by-resume",
      env: { A: "b" },
    });
    expect(res.status).toBe(202);

    await waitFor(id, ["ready", "running"]);
    const body = (await (await get(`/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { name: string; type: string };
    };
    expect(body.sandbox.name).toBe("renamed-by-resume");
    expect(body.sandbox.type).toBe("small");

    const { store } = await import("./db.ts");
    const { operatorScope, runInScope } = await import("./scope.ts");
    expect(await runInScope(operatorScope, () => store.env(id))).toEqual({ A: "b" });
  });

  test("resume with {} preserves existing env", async () => {
    const id = await archivedSandbox();
    const res = await post(`/api/v1/sandboxes/${id}/resume`, {});
    expect(res.status).toBe(202);
    await waitFor(id, ["ready", "running"]);

    const { store } = await import("./db.ts");
    const { operatorScope, runInScope } = await import("./scope.ts");
    expect(await runInScope(operatorScope, () => store.env(id))).toEqual({ INITIAL: "1" });
  });
});

describe("sandbox list pagination, idempotency, patch and fork env", () => {
  test("GET /sandboxes paginates with limit and cursor and filters by stoppedBefore", async () => {
    const prefix = `page-${Date.now()}`;
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const { id } = await createSandbox({ name: `${prefix}-${i}` });
      ids.push(id);
      await Bun.sleep(15);
    }

    const first = (await (
      await get(`/api/v1/sandboxes?namePrefix=${prefix}&limit=2&sort=createdAt:asc`)
    ).json()) as { sandboxes: { id: string }[]; nextCursor: string | null };
    expect(first.sandboxes.map((s) => s.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();

    const second = (await (
      await get(
        `/api/v1/sandboxes?namePrefix=${prefix}&limit=2&sort=createdAt:asc&cursor=${encodeURIComponent(first.nextCursor!)}`,
      )
    ).json()) as { sandboxes: { id: string }[]; nextCursor: string | null };
    expect(second.sandboxes.map((s) => s.id)).toEqual(ids.slice(2));
    expect(second.nextCursor).toBeNull();

    await waitFor(ids[0]!, ["ready", "running"]);
    await post(`/api/v1/sandboxes/${ids[0]!}/stop`, {});
    await waitFor(ids[0]!, ["archived"]);

    const future = new Date(Date.now() + 60_000).toISOString();
    const stopped = (await (
      await get(
        `/api/v1/sandboxes?namePrefix=${prefix}&stoppedBefore=${encodeURIComponent(future)}`,
      )
    ).json()) as { sandboxes: { id: string }[] };
    expect(stopped.sandboxes.map((s) => s.id)).toEqual([ids[0]!]);

    const past = new Date(Date.now() - 60_000).toISOString();
    const noneBeforePast = (await (
      await get(`/api/v1/sandboxes?namePrefix=${prefix}&stoppedBefore=${encodeURIComponent(past)}`)
    ).json()) as { sandboxes: { id: string }[] };
    expect(noneBeforePast.sandboxes).toEqual([]);

    const descPage = (await (
      await get(`/api/v1/sandboxes?namePrefix=${prefix}&limit=2&sort=createdAt:desc`)
    ).json()) as { sandboxes: { id: string }[]; nextCursor: string | null };
    expect(descPage.sandboxes.map((s) => s.id)).toEqual([ids[2]!, ids[1]!]);
    expect(descPage.nextCursor).not.toBeNull();

    for (const badCursor of ["", "not-a-cursor", "12345|foo", "2026-01-01T00:00:00.000Z|bad"]) {
      const bad = await get(`/api/v1/sandboxes?cursor=${encodeURIComponent(badCursor)}`);
      const badBody = (await bad.json()) as { code: string };
      expect({ badCursor, status: bad.status, code: badBody.code }).toEqual({
        badCursor,
        status: 400,
        code: "invalid_query",
      });
    }
  });

  test("Idempotency-Key deduplicates concurrent creates, validates bounds, and sweeps expired keys", async () => {
    const key = `idem-race-${Date.now()}`;
    const req = () =>
      app.request("/api/v1/sandboxes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({ name: "idempotent-box", wait: true }),
      });

    const responses = await Promise.all([req(), req(), req()]);
    const bodies = await Promise.all(
      responses.map(async (r) => ({
        status: r.status,
        body: (await r.json()) as { sandbox: { id: string } },
      })),
    );
    const uniqueIds = new Set(bodies.map((b) => b.body.sandbox.id));
    expect(uniqueIds.size).toBe(1);
    expect(bodies.every((b) => b.status === 201)).toBe(true);

    const badBlank = await app.request("/api/v1/sandboxes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": "   ",
      },
      body: JSON.stringify({}),
    });
    expect(badBlank.status).toBe(400);

    const badLong = await app.request("/api/v1/sandboxes", {
      method: "POST",
      headers: {
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        "idempotency-key": "k".repeat(256),
      },
      body: JSON.stringify({}),
    });
    expect(badLong.status).toBe(400);

    const { store } = await import("./db.ts");
    const [sandboxId] = [...uniqueIds];
    expect(await store.getIdempotencyKey(key)).toBe(sandboxId!);

    const expiredKey = `idem-exp-${Date.now()}`;
    await store.putIdempotencyKey(expiredKey, sandboxId!, new Date(Date.now() - 1000));
    expect(await store.getIdempotencyKey(expiredKey)).toBeNull();
    expect(await store.sweepIdempotencyKeys(new Date())).toBeGreaterThanOrEqual(1);
  });

  test("PATCH /sandboxes/{id} clears labels with null", async () => {
    const { id } = await createSandbox({ labels: { env: "dev" } });
    const res = await call("PATCH", `/api/v1/sandboxes/${id}`, { json: { labels: null } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sandbox: { labels: Record<string, string> } };
    expect(body.sandbox.labels).toEqual({});
  });

  test("POST /sandboxes/{id}/fork inherits source env unless overridden", async () => {
    const { id } = await createSandbox({ env: { KEEP: "yes" } });
    await waitFor(id, ["ready", "running"]);

    const forked = (await (await post(`/api/v1/sandboxes/${id}/fork`, {})).json()) as {
      sandbox: { id: string };
    };
    const overridden = (await (
      await post(`/api/v1/sandboxes/${id}/fork`, { env: { KEEP: "override" } })
    ).json()) as { sandbox: { id: string } };

    const { store } = await import("./db.ts");
    const { operatorScope, runInScope } = await import("./scope.ts");
    expect(await runInScope(operatorScope, () => store.env(forked.sandbox.id))).toEqual({
      KEEP: "yes",
    });
    expect(await runInScope(operatorScope, () => store.env(overridden.sandbox.id))).toEqual({
      KEEP: "override",
    });
  });
});

describe("an empty JSON body means {}", () => {
  test("create with an empty body", async () => {
    const res = await call("POST", "/api/v1/sandboxes", { rawBody: "" });
    expect(res.status).toBe(202);
  });

  test("stop with an empty body", async () => {
    const { id } = await createSandbox();
    await waitFor(id, ["ready", "running"]);
    const res = await call("POST", `/api/v1/sandboxes/${id}/stop`, { rawBody: "" });
    expect([200, 202]).toContain(res.status);
  });

  test("resume with an empty body", async () => {
    const { id } = await createSandbox({ ttlSeconds: 600 });
    await waitFor(id, ["ready", "running"]);
    await post(`/api/v1/sandboxes/${id}/stop`, {});
    await waitFor(id, ["archived"]);
    const res = await call("POST", `/api/v1/sandboxes/${id}/resume`, { rawBody: "" });
    expect(res.status).toBe(202);
  });

  test("a body with no content-length header is also treated as {}", async () => {
    const headers = new Headers({
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
    });
    const request = new Request("http://localhost/api/v1/sandboxes", {
      method: "POST",
      headers,
      body: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    });
    const res = await app.request(request);
    expect(res.status).toBe(202);
  });

  test("genuinely malformed JSON is still an error", async () => {
    const res = await call("POST", "/api/v1/sandboxes", { rawBody: "{ nope" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_body");
  });

  test("a non-JSON empty body is left alone", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      rawBody: "",
      contentType: "application/octet-stream",
    });
    expect([202, 400]).toContain(res.status);
  });
});

describe("auth still applies", () => {
  test("no key is 401", async () => {
    const res = await app.request("/api/v1/sandboxes");
    expect(res.status).toBe(401);
  });
});
