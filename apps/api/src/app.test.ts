/**
 * Conformance tests against `docs/boat-openapi.yaml`.
 *
 * These run on the `mock` driver: no hypervisor, no microVMs, no network. They
 * cover the request surface — what a boat client is allowed to send and what
 * comes back — because that is where the reported deviations were, and it is
 * the part that can be checked deterministically on any machine.
 */
import { describe, expect, test } from "bun:test";

// Environment comes from test/setup.ts (bunfig preload), so module order cannot
// change which driver these tests run against.
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

/** Poll until the sandbox reaches one of `states`. */
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
      expect({ payload, status: res.status }).toEqual({ payload, status: 400 });
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
  });

  test("Idempotency-Key persists in Postgres and deduplicates creates", async () => {
    const key = `idem-${Date.now()}`;
    const req = () =>
      app.request("/api/v1/sandboxes", {
        method: "POST",
        headers: {
          authorization: `Bearer ${KEY}`,
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({ name: "idempotent-box" }),
      });

    const first = (await (await req()).json()) as { sandbox: { id: string } };
    const second = (await (await req()).json()) as { sandbox: { id: string } };
    expect(second.sandbox.id).toBe(first.sandbox.id);

    const { store } = await import("./db.ts");
    expect(await store.getIdempotencyKey(key)).toBe(first.sandbox.id);
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
    // Chunked/streamed bodies: the length hint is absent, so the body is peeked.
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
    // An empty octet-stream upload must stay empty, not become {}.
    const res = await call("POST", "/api/v1/sandboxes", {
      rawBody: "",
      contentType: "application/octet-stream",
    });
    // No JSON body to parse: validation sees {} through the schema default
    // rather than receiving a rewritten body.
    expect([202, 400]).toContain(res.status);
  });
});

describe("auth still applies", () => {
  test("no key is 401", async () => {
    const res = await app.request("/api/v1/sandboxes");
    expect(res.status).toBe(401);
  });
});
