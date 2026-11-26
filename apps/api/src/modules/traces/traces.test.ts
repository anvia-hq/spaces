import { describe, expect, test } from "bun:test";

const { app } = await import("../../app.ts");
const { flushTraces } = await import("./tracer.ts");

const OPERATOR = "test_key";

async function call(
  method: string,
  path: string,
  options: { json?: unknown; token?: string } = {},
) {
  const headers: Record<string, string> = {};

  if (options.json !== undefined) headers["content-type"] = "application/json";

  headers.authorization = `Bearer ${options.token ?? OPERATOR}`;

  return app.request(path, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

type Span = {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  durationMs: number;
  statusCode: string;
  requestId: string | null;
  attributes: Record<string, unknown>;
};

type Trace = {
  traceId: string;
  route: string | null;
  status: string;
  durationMs: number;
  spanCount: number;
  requestId: string | null;
};

async function traces(query = "limit=50"): Promise<Trace[]> {
  const res = await call("GET", `/api/v1/traces?${query}`);
  const body = (await res.json()) as { traces: Trace[] };
  return body.traces;
}

async function waitUntilReady(id: string) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const res = await call("GET", `/api/v1/sandboxes/${id}`);
    const body = (await res.json()) as { sandbox: { state: string } };

    if (body.sandbox.state === "ready" || body.sandbox.state === "error") {
      await Bun.sleep(25);
      return body.sandbox.state;
    }

    await Bun.sleep(25);
  }

  return "timeout";
}

async function spansOf(traceId: string): Promise<Span[]> {
  const res = await call("GET", `/api/v1/traces/${traceId}`);
  return ((await res.json()) as { spans: Span[] }).spans;
}

describe("a request is traced", () => {
  test("the http span carries the route, the status and the request id", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      json: { type: "small", ttlSeconds: 60, name: "traced-sandbox" },
    });
    const requestId = res.headers.get("x-request-id")!;
    expect(res.status).toBe(202);

    const created = (await res.json()) as { sandbox: { id: string } };
    await waitUntilReady(created.sandbox.id);
    await flushTraces();

    const recent = await traces("limit=50");
    const trace = recent.find((entry) => entry.requestId === requestId);

    expect(trace).toBeDefined();
    expect(trace!.route).toBe("/api/v1/sandboxes");
    expect(trace!.status).toBe("ok");
    expect(trace!.spanCount).toBeGreaterThan(1);

    const spans = await spansOf(trace!.traceId);
    const root = spans.find((span) => span.name === "http.request")!;

    expect(root.attributes["http.method"]).toBe("POST");
    expect(root.attributes["http.status_code"]).toBe(202);
    expect(root.parentSpanId).toBeNull();
  });

  test("the work under a request is a child span, not a sibling", async () => {
    const res = await call("GET", "/api/v1/sandboxes?limit=1");
    const requestId = res.headers.get("x-request-id")!;
    await flushTraces();

    const trace = (await traces("limit=50")).find((entry) => entry.requestId === requestId)!;
    const spans = await spansOf(trace.traceId);
    const root = spans.find((span) => !span.parentSpanId)!;
    const children = spans.filter((span) => span.parentSpanId === root.spanId);

    expect(root.name).toBe("http.request");
    expect(children.length).toBeGreaterThan(0);
    expect(spans.some((span) => span.name.startsWith("db."))).toBe(true);
  });

  test("a driver call and the provisioning work are traced", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      json: { type: "small", ttlSeconds: 60, name: "traced-provision" },
    });
    const requestId = res.headers.get("x-request-id")!;
    const created = (await res.json()) as { sandbox: { id: string } };
    await waitUntilReady(created.sandbox.id);
    await flushTraces();

    const trace = (await traces("limit=50")).find((entry) => entry.requestId === requestId)!;
    const spans = await spansOf(trace.traceId);
    const names = spans.map((span) => span.name);

    expect(names).toContain("sandbox.provision");
    expect(names).toContain("driver.create");
    expect(spans.every((span) => typeof span.durationMs === "number")).toBe(true);
  });

  test("a failing request is an error trace", async () => {
    const res = await call("DELETE", "/api/v1/sandboxes/bx_aaaaaaaa");
    expect(res.status).toBe(404);
    const requestId = res.headers.get("x-request-id")!;
    await flushTraces();

    const trace = (await traces("limit=50&status=error")).find(
      (entry) => entry.requestId === requestId,
    );

    expect(trace).toBeDefined();
    expect(trace!.status).toBe("error");
  });
});

describe("reading traces", () => {
  test("metrics summarise the window", async () => {
    const res = await call("POST", "/api/v1/sandboxes", {
      json: { type: "small", ttlSeconds: 60, name: "traced-metrics" },
    });
    const created = (await res.json()) as { sandbox: { id: string } };
    await waitUntilReady(created.sandbox.id);
    await call("GET", "/api/v1/sandboxes");
    await flushTraces();

    const summary = await call("GET", "/api/v1/traces/metrics?windowMinutes=60");
    const body = (await summary.json()) as {
      requests: number;
      errors: number;
      latencyP50Ms: number;
      latencyP95Ms: number;
      lifecycle: { name: string; count: number }[];
    };

    expect(body.requests).toBeGreaterThan(0);
    expect(body.latencyP95Ms).toBeGreaterThanOrEqual(body.latencyP50Ms);
    expect(body.lifecycle.map((entry) => entry.name)).toContain("sandbox.provision");
  });

  test("traces can be found by request id", async () => {
    const res = await call("GET", "/api/v1/sandboxes");
    const requestId = res.headers.get("x-request-id")!;
    await flushTraces();

    const found = await traces(`requestId=${requestId}`);

    expect(found).toHaveLength(1);
    expect(found[0]!.requestId).toBe(requestId);
  });

  test("a teammate reads another user's trace", async () => {
    const mine = await call("POST", "/api/v1/sandboxes", {
      json: { type: "small", ttlSeconds: 60, name: "traced-private" },
    });
    const myRequestId = mine.headers.get("x-request-id")!;
    await flushTraces();
    const myTrace = (await traces("limit=50")).find((entry) => entry.requestId === myRequestId)!;

    const signUp = await app.request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "trace-scope@example.com",
        password: "correct-horse-battery",
        name: "scope",
      }),
    });
    const cookie = signUp.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");

    const keyRes = await app.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "trace-scope" }),
    });
    const key = ((await keyRes.json()) as { key: string }).key;

    const theirs = await app.request("/api/v1/traces?limit=50", {
      headers: { authorization: `Bearer ${key}` },
    });
    const theirTraces = ((await theirs.json()) as { traces: Trace[] }).traces;

    expect(theirTraces.map((entry) => entry.traceId)).toContain(myTrace.traceId);

    const detail = await app.request(`/api/v1/traces/${myTrace.traceId}`, {
      headers: { authorization: `Bearer ${key}` },
    });
    const spans = ((await detail.json()) as { spans: Span[] }).spans;
    expect(spans.length).toBeGreaterThan(0);
  });
});
