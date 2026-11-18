import { describe, expect, test } from "bun:test";
import { OPERATOR_KEY } from "../../testing/control-plane.ts";

const { app } = await import("../../app.ts");
const { config } = await import("../../config.ts");

const PASSWORD = "correct-horse-battery";
let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36).slice(-4)}${sequence}`;
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; token?: string; cookie?: string } = {},
) {
  const headers: Record<string, string> = { origin: config.auth.url };

  if (options.cookie) headers.cookie = options.cookie;
  else headers.authorization = `Bearer ${options.token ?? OPERATOR_KEY}`;

  if (options.json !== undefined) headers["content-type"] = "application/json";

  return app.request(path, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

type RuntimeBody = {
  ok: boolean;
  runtime: {
    id: string;
    name: string;
    kind: string;
    state: string;
    draining: boolean;
    maxSandboxes: number | null;
    labels: Record<string, string>;
    tokenPrefix: string | null;
  };
  token?: string;
};

async function register(name: string, json: Record<string, unknown> = {}) {
  const res = await call("POST", "/api/v1/runtimes", { json: { name, ...json } });
  return { res, body: (await res.json()) as RuntimeBody };
}

describe("the registry", () => {
  test("the built-in runtime is always there, online, and cannot be deleted or rotated", async () => {
    const list = await call("GET", "/api/v1/runtimes");
    const { runtimes } = (await list.json()) as { runtimes: RuntimeBody["runtime"][] };
    const local = runtimes.find((runtime) => runtime.id === "local");

    expect(local).toMatchObject({ name: "local", kind: "local", state: "online" });

    const removed = await call("DELETE", "/api/v1/runtimes/local");
    expect(removed.status).toBe(403);

    const rotated = await call("POST", "/api/v1/runtimes/local/token");
    expect(rotated.status).toBe(400);
  });

  test("registering shows the token once; reading it back never does", async () => {
    const name = unique("reg");
    const { res, body } = await register(name, { labels: { zone: "eu" }, maxSandboxes: 4 });

    expect(res.status).toBe(201);
    expect(body.token).toMatch(/^spr_[0-9a-f]{48}$/);
    expect(body.runtime).toMatchObject({
      name,
      kind: "agent",
      state: "offline",
      draining: false,
      maxSandboxes: 4,
      labels: { zone: "eu" },
    });
    expect(body.runtime.tokenPrefix).toBe(body.token!.slice(0, 12));

    const read = await call("GET", `/api/v1/runtimes/${name}`);
    const text = await read.text();
    expect(text).not.toContain(body.token!);
    expect(text).not.toContain("tokenHash");

    const byId = await call("GET", `/api/v1/runtimes/${body.runtime.id}`);
    expect(byId.status).toBe(200);
  });

  test("a name is lowercase, short and unique", async () => {
    const name = unique("dup");
    await register(name);

    const again = await register(name);
    expect(again.res.status).toBe(409);

    const upper = await call("POST", "/api/v1/runtimes", { json: { name: "Edge" } });
    expect(upper.status).toBe(400);

    const stray = await call("POST", "/api/v1/runtimes", { json: { name: unique("x"), color: 1 } });
    expect(stray.status).toBe(400);
  });

  test("an unknown runtime is a 404, by id or by name", async () => {
    expect((await call("GET", "/api/v1/runtimes/nowhere")).status).toBe(404);
    expect((await call("DELETE", "/api/v1/runtimes/nowhere")).status).toBe(404);
  });

  test("labels, cap and draining can be changed, and unknown fields are refused", async () => {
    const { body } = await register(unique("patch"));
    const id = body.runtime.id;

    const changed = await call("PATCH", `/api/v1/runtimes/${id}`, {
      json: { labels: { tier: "gpu" }, maxSandboxes: 2, draining: true },
    });
    expect(changed.status).toBe(200);
    expect(((await changed.json()) as RuntimeBody).runtime).toMatchObject({
      labels: { tier: "gpu" },
      maxSandboxes: 2,
      draining: true,
    });

    const cleared = await call("PATCH", `/api/v1/runtimes/${id}`, { json: { maxSandboxes: null } });
    expect(((await cleared.json()) as RuntimeBody).runtime.maxSandboxes).toBeNull();

    const refused = await call("PATCH", `/api/v1/runtimes/${id}`, { json: { color: "red" } });
    expect(refused.status).toBe(400);
  });

  test("a runtime can be renamed; its id and its sandboxes do not change", async () => {
    const { body } = await register(unique("before"));
    const after = unique("after");

    const renamed = await call("PATCH", `/api/v1/runtimes/${body.runtime.id}`, {
      json: { name: after },
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as RuntimeBody).runtime).toMatchObject({
      id: body.runtime.id,
      name: after,
    });

    expect((await call("GET", `/api/v1/runtimes/${after}`)).status).toBe(200);
    expect((await call("GET", `/api/v1/runtimes/${body.runtime.name}`)).status).toBe(404);
  });

  test("renaming to a name that is taken, or is not a name, is refused", async () => {
    const taken = await register(unique("taken"));
    const { body } = await register(unique("mine"));

    const clash = await call("PATCH", `/api/v1/runtimes/${body.runtime.id}`, {
      json: { name: taken.body.runtime.name },
    });
    expect(clash.status).toBe(409);

    const bad = await call("PATCH", `/api/v1/runtimes/${body.runtime.id}`, {
      json: { name: "Not A Name" },
    });
    expect(bad.status).toBe(400);

    const same = await call("PATCH", `/api/v1/runtimes/${body.runtime.id}`, {
      json: { name: body.runtime.name },
    });
    expect(same.status).toBe(200);
  });

  test("rotating a token changes the prefix and invalidates the old one", async () => {
    const { body } = await register(unique("rot"));
    const rotated = await call("POST", `/api/v1/runtimes/${body.runtime.id}/token`);
    const next = (await rotated.json()) as RuntimeBody;

    expect(rotated.status).toBe(200);
    expect(next.token).not.toBe(body.token);
    expect(next.runtime.tokenPrefix).toBe(next.token!.slice(0, 12));
  });

  test("an empty runtime can be deleted and is gone afterwards", async () => {
    const { body } = await register(unique("gone"));
    const removed = await call("DELETE", `/api/v1/runtimes/${body.runtime.id}`);

    expect(removed.status).toBe(200);
    expect((await call("GET", `/api/v1/runtimes/${body.runtime.id}`)).status).toBe(404);
  });

  test("the health answer counts runtimes", async () => {
    const res = await app.request("/health");
    const health = (await res.json()) as { runtimes: { online: number; total: number } };

    expect(health.runtimes.total).toBeGreaterThanOrEqual(1);
    expect(health.runtimes.online).toBeGreaterThanOrEqual(1);
  });
});

describe("who may change the registry", () => {
  async function signUp(email: string) {
    const res = await call("POST", "/api/auth/sign-up/email", {
      json: { email, password: PASSWORD, name: email.split("@")[0] },
    });
    expect(res.status).toBe(200);

    return res.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0]!)
      .join("; ");
  }

  test("a person without the admin role can look, and cannot register, change, rotate or delete", async () => {
    const { body } = await register(unique("guard"));
    const cookie = await signUp(`${unique("person")}@example.com`);

    const list = await call("GET", "/api/v1/runtimes", { cookie });
    expect(list.status).toBe(200);

    const attempts = [
      call("POST", "/api/v1/runtimes", { cookie, json: { name: unique("nope") } }),
      call("PATCH", `/api/v1/runtimes/${body.runtime.id}`, { cookie, json: { draining: true } }),
      call("POST", `/api/v1/runtimes/${body.runtime.id}/token`, { cookie }),
      call("DELETE", `/api/v1/runtimes/${body.runtime.id}`, { cookie }),
    ];

    for (const res of await Promise.all(attempts)) {
      expect(res.status).toBe(403);
      expect(((await res.json()) as { code: string }).code).toBe("forbidden");
    }
  });

  test("the audit log records a registration without the token", async () => {
    const name = unique("audited");
    const { body } = await register(name);
    const res = await call("GET", "/api/v1/audit-log?limit=50");
    const text = await res.text();

    expect(text).toContain("runtime.create");
    expect(text).not.toContain(body.token!);
  });
});
