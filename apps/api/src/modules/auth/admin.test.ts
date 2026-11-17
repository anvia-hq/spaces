/**
 * An admin is an account with a role, not a second shared secret.
 *
 * Runs on the mock driver like the rest of the suite. What matters: the
 * bootstrap list promotes a listed address once and the role survives a new
 * session, an admin changes what only the operator could, a key carries its
 * owner's role, the last admin cannot be demoted or banned, and the operator key
 * answers exactly as it did before (docs/decision/0037).
 */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";

const { app } = await import("../../app.ts");
const { config } = await import("../../config.ts");
const { db, one } = await import("../../db.ts");
const { user } = await import("@spaces/db");

const OPERATOR = "test_key";
const PASSWORD = "correct-horse-battery";

type Options = { json?: unknown; token?: string; cookie?: string };
type Credential = { token: string } | { cookie: string };
type Me = {
  principal: { kind: string; role?: string };
  operator: boolean;
  role?: string;
  admin?: boolean;
};

async function call(method: string, path: string, options: Options = {}) {
  const headers: Record<string, string> = { origin: config.auth.url };

  if (options.json !== undefined) headers["content-type"] = "application/json";

  if (options.token) headers.authorization = `Bearer ${options.token}`;

  if (options.cookie) headers.cookie = options.cookie;

  return app.request(path, {
    method,
    headers,
    body: options.json === undefined ? undefined : JSON.stringify(options.json),
  });
}

/**
 * `SPACES_ADMIN_EMAILS` is read once, when `config` is built, so a test writes
 * the list itself. Put back what was there: the next file sees the same config.
 */
async function withListed(emails: string[], body: () => Promise<void>) {
  config.adminEmails.push(...emails);

  try {
    await body();
  } finally {
    config.adminEmails.length = 0;
  }
}

function cookieOf(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((entry) => entry.split(";")[0]!)
    .join("; ");
}

async function signUp(email: string) {
  const res = await call("POST", "/api/auth/sign-up/email", {
    json: { email, password: PASSWORD, name: email.split("@")[0] },
  });
  return { res, cookie: cookieOf(res) };
}

async function signIn(email: string) {
  const res = await call("POST", "/api/auth/sign-in/email", {
    json: { email, password: PASSWORD },
  });
  return { res, cookie: cookieOf(res) };
}

async function me(credential: Credential): Promise<Me> {
  const res = await call("GET", "/api/v1/me", credential);
  return (await res.json()) as Me;
}

async function idOf(email: string): Promise<string> {
  const row = await one(db.select({ id: user.id }).from(user).where(eq(user.email, email)));
  return row?.id ?? "";
}

async function roleOf(email: string): Promise<string | null> {
  const row = await one(db.select({ role: user.role }).from(user).where(eq(user.email, email)));
  return row?.role ?? null;
}

async function adminRows(email: string) {
  const res = await call("GET", "/api/v1/audit-log?action=auth.admin_bootstrap", {
    token: OPERATOR,
  });
  const body = (await res.json()) as { entries: { target: { id: string } }[] };
  const id = await idOf(email);
  return body.entries.filter((entry) => entry.target.id === id);
}

async function createKey(cookie: string, name: string): Promise<string> {
  const res = await call("POST", "/api/v1/api-keys", { cookie, json: { name } });
  const body = (await res.json()) as { key?: string };
  return body.key ?? "";
}

async function setRole(cookie: string, userId: string, role: "admin" | "user") {
  return call("POST", `/api/v1/users/${userId}/role`, { cookie, json: { role } });
}

async function createSize(credential: Credential, name: string) {
  return call("POST", "/api/v1/machine-sizes", {
    ...credential,
    json: { name, vcpu: 2, memMib: 2048, diskGb: 21 },
  });
}

describe("the bootstrap list", () => {
  test("promotes a listed address once, and the role stays across sessions", async () => {
    await withListed(["boss@example.com"], async () => {
      const { cookie } = await signUp("boss@example.com");
      expect(await me({ cookie })).toMatchObject({ admin: true, role: "admin" });

      await call("POST", "/api/auth/sign-out", { cookie });
      const again = await signIn("boss@example.com");

      expect(again.res.status).toBe(200);
      expect(await me({ cookie: again.cookie })).toMatchObject({ admin: true, role: "admin" });
      expect(await roleOf("boss@example.com")).toBe("admin");
      expect(await adminRows("boss@example.com")).toHaveLength(1);
    });
  });

  test("an address that is not on the list is an ordinary user", async () => {
    await withListed(["someone-else@example.com"], async () => {
      const { cookie } = await signUp("worker@example.com");
      expect(await me({ cookie })).toMatchObject({ admin: false, role: "user" });
      expect(await adminRows("worker@example.com")).toHaveLength(0);
    });
  });

  test("the list is empty by default", async () => {
    expect(config.adminEmails).toHaveLength(0);
  });
});

describe("what an admin may do", () => {
  test("an admin session changes machine sizes; a plain user is still refused", async () => {
    await withListed(["maker@example.com"], async () => {
      const { cookie: adminCookie } = await signUp("maker@example.com");

      const allowed = await createSize({ cookie: adminCookie }, "admin-picked");
      expect(allowed.status).toBe(201);
    });

    const { cookie: userCookie } = await signUp("watcher@example.com");
    const refused = await createSize({ cookie: userCookie }, "user-picked");
    const body = (await refused.json()) as { code: string; message: string };

    expect(refused.status).toBe(403);
    expect(body.code).toBe("forbidden");
    expect(body.message).toContain("admin");

    const listed = await call("GET", "/api/v1/machine-sizes", { cookie: userCookie });
    const sizes = (await listed.json()) as { sizes: { name: string }[] };
    expect(sizes.sizes.map((size) => size.name)).toContain("admin-picked");
    expect(sizes.sizes.map((size) => size.name)).not.toContain("user-picked");
  });

  test("an API key owned by an admin carries the role", async () => {
    await withListed(["keyed@example.com"], async () => {
      const { cookie } = await signUp("keyed@example.com");
      const key = await createKey(cookie, "admin-ci");
      const answer = await me({ token: key });
      expect(answer).toMatchObject({ admin: true, role: "admin" });
      expect(answer.principal.role).toBe("admin");

      expect((await createSize({ token: key }, "keyed-picked")).status).toBe(201);
    });
  });

  test("a key created before a promotion picks the role up", async () => {
    const { cookie } = await signUp("promoted@example.com");
    const key = await createKey(cookie, "before-promotion");
    expect((await me({ token: key })).admin).toBe(false);

    await withListed(["promoted@example.com"], async () => {
      await signIn("promoted@example.com");
      expect((await me({ token: key })).admin).toBe(true);
    });
  });

  test("the users list is the admin's, and refuses everybody else", async () => {
    const { cookie: plain } = await signUp("nobody@example.com");
    expect((await call("GET", "/api/v1/users", { cookie: plain })).status).toBe(403);

    await withListed(["listing@example.com"], async () => {
      const { cookie: adminCookie } = await signUp("listing@example.com");
      const listed = await call("GET", "/api/v1/users?limit=100", { cookie: adminCookie });
      const body = (await listed.json()) as {
        users: { email: string; role: string; admin: boolean }[];
      };

      expect(listed.status).toBe(200);
      expect(body.users.find((row) => row.email === "listing@example.com")).toMatchObject({
        role: "admin",
        admin: true,
      });
      expect(body.users.find((row) => row.email === "nobody@example.com")).toMatchObject({
        role: "user",
        admin: false,
      });
    });

    const byOperator = await call("GET", "/api/v1/users?search=nobody@", { token: OPERATOR });
    expect(byOperator.status).toBe(200);
    expect(((await byOperator.json()) as { users: { email: string }[] }).users).toHaveLength(1);
  });
});

describe("refusing to remove the last admin", () => {
  test("demoting the only admin is a 403 and changes nothing", async () => {
    const { demoteAllAdmins } = await import("./admins.ts");
    expect(await demoteAllAdmins()).toBeGreaterThan(0);

    await withListed(["last@example.com"], async () => {
      const { cookie } = await signUp("last@example.com");
      const self = await idOf("last@example.com");

      const demote = await setRole(cookie, self, "user");
      expect(demote.status).toBe(403);
      expect(((await demote.json()) as { message: string }).message).toContain("last admin");
      expect(await roleOf("last@example.com")).toBe("admin");

      const ban = await call("POST", `/api/v1/users/${self}/ban`, { cookie, json: {} });
      expect(ban.status).toBe(403);
      expect(await roleOf("last@example.com")).toBe("admin");
    });
  });

  test("with two admins, one may demote the other", async () => {
    await withListed(["first@example.com", "second@example.com"], async () => {
      const { cookie: firstCookie } = await signUp("first@example.com");
      await signUp("second@example.com");

      const second = await idOf("second@example.com");
      const demote = await setRole(firstCookie, second, "user");

      expect(demote.status).toBe(200);
      expect(((await demote.json()) as { user: { role: string } }).user.role).toBe("user");
      expect(await roleOf("second@example.com")).toBe("user");
    });
  });

  test("a ban is audited under the target, and an unban undoes it", async () => {
    await withListed(["bans@example.com"], async () => {
      const { cookie } = await signUp("bans@example.com");
      await signUp("victim@example.com");

      const victim = await idOf("victim@example.com");
      const banned = await call("POST", `/api/v1/users/${victim}/ban`, {
        cookie,
        json: { reason: "spam" },
      });
      expect(banned.status).toBe(200);
      expect(((await banned.json()) as { user: { banned: boolean } }).user.banned).toBe(true);

      const log = await call("GET", "/api/v1/audit-log?action=user.ban", { cookie });
      const entries = ((await log.json()) as { entries: { target: { id: string } }[] }).entries;
      expect(entries[0]?.target.id).toBe(victim);

      const unbanned = await call("DELETE", `/api/v1/users/${victim}/ban`, { cookie });
      expect(((await unbanned.json()) as { user: { banned: boolean } }).user.banned).toBe(false);
    });
  });
});

describe("the operator key is unaffected", () => {
  test("it is still an operator, lists users and changes sizes", async () => {
    const answer = await me({ token: OPERATOR });
    expect(answer.operator).toBe(true);
    expect(answer.admin).toBe(true);
    expect(answer.principal.kind).toBe("operator");

    expect((await createSize({ token: OPERATOR }, "operator-picked")).status).toBe(201);
    expect((await call("GET", "/api/v1/users", { token: OPERATOR })).status).toBe(200);
  });

  /**
   * No sandbox fixture here on purpose: the suite shares one database and its
   * other files fill the deployment limit, so creating one from this file makes
   * them fail. `scope.ts` is covered by `machine-sizes/sandbox-presets.test.ts`.
   */
});
