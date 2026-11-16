/**
 * Accounts and keys: sign-up, key lifecycle, and the isolation those keys buy.
 *
 * Runs on the mock driver like the rest of the suite. The operator key still
 * works — it is what an existing deploy and the console's local default use —
 * so both credential paths are exercised here (docs/decision/0028).
 */
import { describe, expect, test } from "bun:test";

const { app } = await import("../../app.ts");

const OPERATOR = "test_key";

type Options = { json?: unknown; token?: string; cookie?: string; origin?: string };

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = {};

  if (options.json !== undefined) headers["content-type"] = "application/json";

  if (options.token) headers.authorization = `Bearer ${options.token}`;

  if (options.cookie) headers.cookie = options.cookie;

  if (options.origin) headers.origin = options.origin;

  return app.request(path, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

function cookieOf(res: Response): string {
  const jars = res.headers.getSetCookie();
  return jars.map((entry) => entry.split(";")[0]!).join("; ");
}

async function signUp(email: string) {
  const res = await call("POST", "/api/auth/sign-up/email", {
    json: { email, password: "correct-horse-battery", name: email.split("@")[0] },
  });
  return { res, cookie: cookieOf(res) };
}

async function createKey(cookie: string, name: string) {
  const res = await call("POST", "/api/v1/api-keys", { cookie, json: { name } });
  const body = (await res.json()) as { key?: string; entry?: { id: string } };
  return { res, key: body.key ?? "", id: body.entry?.id ?? "" };
}

async function createSandbox(token: string, name: string) {
  const res = await call("POST", "/api/v1/sandboxes", {
    token,
    json: { type: "small", ttlSeconds: 60, name },
  });
  const body = (await res.json()) as { sandbox?: { id: string } };
  return { res, id: body.sandbox?.id ?? "" };
}

describe("sign-up", () => {
  test("creates a user and a session cookie", async () => {
    const { res, cookie } = await signUp("alice@example.com");
    expect(res.status).toBe(200);
    expect(cookie).toContain("session_token");

    const me = await call("GET", "/api/v1/me", { cookie });
    const body = (await me.json()) as { principal: { kind: string; email: string } };
    expect(me.status).toBe(200);
    expect(body.principal.kind).toBe("user");
    expect(body.principal.email).toBe("alice@example.com");
  });

  test("the same email cannot sign up twice", async () => {
    const { res } = await signUp("alice@example.com");
    expect(res.ok).toBe(false);
  });

  test("no credential at all is still 401", async () => {
    const res = await call("GET", "/api/v1/sandboxes");
    expect(res.status).toBe(401);
  });
});

describe("API keys", () => {
  test("a key can be created, used, listed and revoked", async () => {
    const { cookie } = await signUp("bob@example.com");
    const created = await createKey(cookie, "ci");
    expect(created.res.status).toBe(201);
    expect(created.key.startsWith("spk_")).toBe(true);

    const made = await createSandbox(created.key, "bob-key-sandbox");
    expect(made.res.status).toBe(202);

    const listed = await call("GET", "/api/v1/api-keys", { cookie });
    const body = (await listed.json()) as { keys: { id: string; name: string }[] };
    expect(body.keys.map((k) => k.name)).toContain("ci");

    const revoked = await call("DELETE", `/api/v1/api-keys/${created.id}`, { cookie });
    expect(revoked.status).toBe(200);

    const after = await call("GET", "/api/v1/sandboxes", { token: created.key });
    expect(after.status).toBe(401);
  });

  test("a key cannot mint another key", async () => {
    const { cookie } = await signUp("carol@example.com");
    const created = await createKey(cookie, "one");
    const escape = await call("POST", "/api/v1/api-keys", {
      token: created.key,
      json: { name: "two" },
    });
    expect(escape.status).toBe(403);
  });

  test("the operator key cannot manage keys either", async () => {
    const res = await call("POST", "/api/v1/api-keys", {
      token: OPERATOR,
      json: { name: "operator" },
    });
    expect(res.status).toBe(403);
  });
});

describe("one user cannot see another's resources", () => {
  test("a sandbox created with one user's key is invisible to the other", async () => {
    const { cookie: danaCookie } = await signUp("dana@example.com");
    const dana = await createKey(danaCookie, "dana");
    const sandbox = await createSandbox(dana.key, "dana-sandbox");
    expect(sandbox.res.status).toBe(202);

    const { cookie: erinCookie } = await signUp("erin@example.com");
    const erin = await createKey(erinCookie, "erin");

    const fetched = await call("GET", `/api/v1/sandboxes/${sandbox.id}`, { token: erin.key });
    expect(fetched.status).toBe(404);

    const deleted = await call("DELETE", `/api/v1/sandboxes/${sandbox.id}`, { token: erin.key });
    expect(deleted.status).toBe(404);

    const listed = await call("GET", "/api/v1/sandboxes", { token: erin.key });
    const body = (await listed.json()) as { sandboxes: { id: string }[] };
    expect(body.sandboxes.map((s) => s.id)).not.toContain(sandbox.id);

    const events = await call("GET", `/api/v1/sandboxes/${sandbox.id}/events`, { token: erin.key });
    const eventBody = (await events.json()) as { events: unknown[] };
    expect(eventBody.events).toHaveLength(0);

    const own = await call("GET", `/api/v1/sandboxes/${sandbox.id}`, { token: dana.key });
    expect(own.status).toBe(200);
  });

  test("a saved-snapshot name cannot be taken over by another account", async () => {
    const { cookie: frankCookie } = await signUp("frank@example.com");
    const frank = await createKey(frankCookie, "frank");
    const sandbox = await createSandbox(frank.key, "frank-sandbox");

    const first = await call("POST", "/api/v1/saved-snapshots", {
      token: frank.key,
      json: { sandboxId: sandbox.id, name: "shared-name" },
    });
    expect(first.status).toBe(202);

    const { cookie: ginaCookie } = await signUp("gina@example.com");
    const gina = await createKey(ginaCookie, "gina");
    const second = await call("POST", "/api/v1/saved-snapshots", {
      token: gina.key,
      json: { sandboxId: sandbox.id, name: "shared-name" },
    });
    expect(second.status).not.toBe(202);

    const ginaList = await call("GET", "/api/v1/saved-snapshots", { token: gina.key });
    const body = (await ginaList.json()) as { snapshots: { name: string }[] };
    expect(body.snapshots).toHaveLength(0);

    await call("DELETE", "/api/v1/saved-snapshots/shared-name", { token: frank.key });
  });

  test("the operator key still sees every sandbox", async () => {
    const res = await call("GET", "/api/v1/sandboxes", { token: OPERATOR });
    const body = (await res.json()) as { sandboxes: { id: string }[] };
    expect(body.sandboxes.length).toBeGreaterThan(0);
  });
});
