/**
 * The audit log: every mutation, once, with who and where from.
 *
 * Runs on the mock driver like the rest of the suite. The interesting properties
 * are coverage (a route nobody remembered still lands), scoping (a user reads
 * their own), and the keyset page (it keeps walking while the log grows).
 */
import { describe, expect, test } from "bun:test";

const { app } = await import("../../app.ts");

const OPERATOR = "test_key";

type Options = { json?: unknown; token?: string; cookie?: string };

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = {};

  if (options.json !== undefined) headers["content-type"] = "application/json";

  if (options.token) headers.authorization = `Bearer ${options.token}`;

  if (options.cookie) headers.cookie = options.cookie;

  return app.request(path, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]!)
    .join("; ");
}

async function signUp(email: string) {
  const res = await call("POST", "/api/auth/sign-up/email", {
    json: { email, password: "correct-horse-battery", name: email.split("@")[0] },
  });
  return cookieOf(res);
}

async function createKey(cookie: string, name: string) {
  const res = await call("POST", "/api/v1/api-keys", { cookie, json: { name } });
  const body = (await res.json()) as { key: string; entry: { id: string } };
  return body;
}

type Entry = {
  id: string;
  at: string;
  action: string;
  result: string;
  status: number | null;
  actor: { kind: string; id: string | null; label: string | null };
  target: { type: string | null; id: string | null };
  requestId: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
};

async function entries(query: string, token = OPERATOR) {
  const res = await call("GET", `/api/v1/audit-log?${query}`, { token });
  const body = (await res.json()) as { entries: Entry[]; nextCursor: string | null };
  return body;
}

describe("every mutation is recorded", () => {
  test("create, stop and delete of one sandbox", async () => {
    const created = await call("POST", "/api/v1/sandboxes", {
      token: OPERATOR,
      json: { type: "small", ttlSeconds: 60, name: "audited-sandbox" },
    });
    const sandbox = ((await created.json()) as { sandbox: { id: string } }).sandbox;

    await call("POST", `/api/v1/sandboxes/${sandbox.id}/stop`, { token: OPERATOR, json: {} });
    await call("DELETE", `/api/v1/sandboxes/${sandbox.id}`, { token: OPERATOR });

    const listed = await entries(`targetId=${sandbox.id}&limit=50`);
    const actions = listed.entries.map((entry) => entry.action);

    expect(actions).toContain("sandbox.create");
    expect(actions).toContain("sandbox.stop");
    expect(actions).toContain("sandbox.delete");

    const create = listed.entries.find((entry) => entry.action === "sandbox.create")!;
    expect(create.actor.kind).toBe("operator");
    expect(create.result).toBe("ok");
    expect(create.status).toBe(202);
    expect(create.requestId).toStartWith("req_");
    expect(create.durationMs).toBeGreaterThanOrEqual(0);
    expect(create.metadata).toMatchObject({ type: "small", name: "audited-sandbox" });
  });

  test("a failed request is recorded with its error code", async () => {
    const missing = await call("DELETE", "/api/v1/sandboxes/bx_aaaaaaaa", { token: OPERATOR });
    expect(missing.status).toBe(404);

    const listed = await entries("targetId=bx_aaaaaaaa&limit=10");
    const entry = listed.entries[0]!;

    expect(entry.action).toBe("sandbox.delete");
    expect(entry.result).toBe("error");
    expect(entry.status).toBe(404);
  });

  test("a key create and revoke are recorded", async () => {
    const cookie = await signUp("audit-keys@example.com");
    const created = await createKey(cookie, "audited-key");

    await call("DELETE", `/api/v1/api-keys/${created.entry.id}`, { cookie });

    const listed = await entries(`targetId=${created.entry.id}&limit=10`);
    const actions = listed.entries.map((entry) => entry.action);

    expect(actions).toContain("api_key.create");
    expect(actions).toContain("api_key.revoke");
  });

  test("sign-up, sign-in and sign-out are recorded", async () => {
    const cookie = await signUp("audit-auth@example.com");

    const me = await call("GET", "/api/v1/me", { cookie });
    const userId = ((await me.json()) as { principal: { userId: string } }).principal.userId;

    await call("POST", "/api/auth/sign-out", { cookie });

    const listed = await entries(`actorId=${userId}&limit=50`);
    const actions = listed.entries.map((entry) => entry.action);

    expect(actions).toContain("auth.sign_up");
    expect(actions).toContain("auth.sign_in");
    expect(actions).toContain("auth.sign_out");
  });

  test("a read is not recorded", async () => {
    const before = await entries("action=sandbox.list&limit=1");
    await call("GET", "/api/v1/sandboxes", { token: OPERATOR });
    const after = await entries("action=sandbox.list&limit=1");

    expect(before.entries).toHaveLength(0);
    expect(after.entries).toHaveLength(0);
  });
});

describe("reading the log", () => {
  test("filtering by action narrows to that action", async () => {
    const listed = await entries("action=sandbox.create&limit=200");
    expect(listed.entries.length).toBeGreaterThan(0);
    expect(listed.entries.every((entry) => entry.action === "sandbox.create")).toBe(true);
  });

  test("a keyset cursor walks the whole log without repeating a row", async () => {
    const first = await entries("limit=3");
    expect(first.entries).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();

    const second = await entries(`limit=3&cursor=${first.nextCursor}`);

    expect(second.entries.length).toBeGreaterThan(0);
    const overlap = second.entries.filter((entry) =>
      first.entries.some((earlier) => earlier.id === entry.id),
    );
    expect(overlap).toHaveLength(0);
  });

  test("the action list only contains actions that happened", async () => {
    const res = await call("GET", "/api/v1/audit-log/actions", { token: OPERATOR });
    const body = (await res.json()) as { actions: string[] };
    expect(body.actions).toContain("sandbox.create");
    expect(body.actions).not.toContain("never.happened");
  });

  test("the log has no write, update or delete route", async () => {
    expect((await call("POST", "/api/v1/audit-log", { token: OPERATOR, json: {} })).status).toBe(
      404,
    );
    expect((await call("DELETE", "/api/v1/audit-log/aud_x", { token: OPERATOR })).status).toBe(404);
  });
});

describe("one user cannot read another's log", () => {
  test("a user sees their own entries and not the operator's", async () => {
    const cookie = await signUp("audit-scope@example.com");
    const key = await createKey(cookie, "scope-key");
    const sandbox = await call("POST", "/api/v1/sandboxes", {
      token: key.key,
      json: { type: "small", ttlSeconds: 60, name: "scoped-audit" },
    });
    const id = ((await sandbox.json()) as { sandbox: { id: string } }).sandbox.id;

    const mine = await entries("limit=200", key.key);
    expect(mine.entries.length).toBeGreaterThan(0);
    expect(mine.entries.every((entry) => entry.actor.kind === "user")).toBe(true);
    expect(mine.entries.map((entry) => entry.target.id)).toContain(id);

    const someoneElse = await signUp("audit-scope-2@example.com");
    const otherKey = await createKey(someoneElse, "scope-key-2");
    const theirs = await entries("limit=200", otherKey.key);

    expect(theirs.entries.every((entry) => entry.target.id !== id)).toBe(true);

    const operator = await entries("limit=200");
    expect(operator.entries.map((entry) => entry.target.id)).toContain(id);
  });
});
