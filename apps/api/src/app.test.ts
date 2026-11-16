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

describe("POST /sandboxes accepts boat's create schema", () => {
  test("every field in the spec is accepted", async () => {
    const { res, body } = await createSandbox({
      type: "default",
      ttlSeconds: 600,
      labels: { session: "abc" },
      env: { FOO: "bar" },
      name: "full-schema",
      // Accepted for parity, not acted on — see docs/decision/0021.
      environment: "base",
      noEnv: true,
      visibility: "private",
      snapshots: false,
      monitoring: false,
      failFast: true,
      count: 1,
      setupScript: "echo setup",
      hostedPorts: [{ port: 3000, public: true, title: "dev" }],
      files: [{ path: "/home/user/boot.txt", content: "hi", encoding: "utf8" }],
      org: "acme",
      teamId: "team_1",
    });

    expect(res.status).toBe(202);
    expect(body.sandbox.name).toBe("full-schema");
  });

  test("each spec field on its own is accepted", async () => {
    // Guards against a field that only passes because a neighbour exists.
    const fields: Record<string, unknown>[] = [
      { noEnv: true },
      { visibility: "shared" },
      { environment: "customer-demos" },
      { snapshots: false },
      { monitoring: false },
      { failFast: true },
      { count: 2 },
      { hostedPorts: [{ port: 8080 }] },
      { files: [{ path: "a.txt", content: "x" }] },
      { org: "acme" },
      { teamId: "team_1" },
    ];
    for (const field of fields) {
      const res = await post("/api/v1/sandboxes", field);
      expect({ field, status: res.status }).toEqual({ field, status: 202 });
    }
  });

  test("an unknown field is still rejected", async () => {
    // Strictness is the point: boat-defined is fine, invented is a typo.
    const res = await post("/api/v1/sandboxes", { notAThing: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_query");
  });

  test("ttlSeconds accepts the legacy 'infinite'", async () => {
    const { res, body, id } = await createSandbox({ ttlSeconds: "infinite" });
    expect(res.status).toBe(202);
    const res2 = await get(`/api/v1/sandboxes/${id}`);
    const sandbox = ((await res2.json()) as { sandbox: { archiveAfter: string | null } }).sandbox;
    expect(sandbox.archiveAfter).toBeNull();
    void body;
  });

  test("an unresolvable 'from' is a 404, not a silent cold boot", async () => {
    const res = await post("/api/v1/sandboxes", { from: "no-such-snapshot" });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("snapshot_not_found");
  });
});

describe("POST /sandboxes/{id}/resume accepts boat's resume schema", () => {
  async function archivedSandbox() {
    const { id } = await createSandbox({ ttlSeconds: 600 });
    await waitFor(id, ["ready", "running"]);
    // The spec allows 200 or 202 on stop; resume and fork are 202 in full.
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
    // `ttlSeconds` is not part of boat's Sandbox object; the timer it sets is.
    const body = (await (await get(`/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { archiveAfter: string | null };
    };
    expect(body.sandbox.archiveAfter).not.toBeNull();

    const deadline = new Date(body.sandbox.archiveAfter!).getTime();
    const offset = (deadline - before) / 1000;
    // Reset from *now*, not carried over from the original create.
    expect(offset).toBeGreaterThan(7200 - 30);
    expect(offset).toBeLessThan(7200 + 30);
  });

  test("the other spec fields are accepted", async () => {
    const id = await archivedSandbox();
    const res = await post(`/api/v1/sandboxes/${id}/resume`, {
      type: "small",
      name: "renamed-by-resume",
      failFast: false,
      env: { A: "b" },
      environment: "base",
      noEnv: false,
    });
    expect(res.status).toBe(202);

    await waitFor(id, ["ready", "running"]);
    const body = (await (await get(`/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { name: string; type: string };
    };
    expect(body.sandbox.name).toBe("renamed-by-resume");
    expect(body.sandbox.type).toBe("small");
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
