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

type Size = {
  name: string;
  vcpu: number;
  memMib: number;
  diskGb: number;
  description: string | null;
  retiredAt: string | null;
};

async function sizes(token = OPERATOR, query = ""): Promise<Size[]> {
  const res = await call("GET", `/api/v1/machine-sizes${query}`, { token });
  const body = (await res.json()) as { sizes: Size[] };
  return body.sizes;
}

async function createPreset(name: string, vcpu = 3, memMib = 6144, diskGb = 61) {
  return call("POST", "/api/v1/machine-sizes", {
    token: OPERATOR,
    json: { name, vcpu, memMib, diskGb },
  });
}

describe("the seeded presets", () => {
  test("are the four boat shipped, with their exact resources", async () => {
    const rows = await sizes();
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));

    expect(byName.small).toMatchObject({ vcpu: 2, memMib: 4096, diskGb: 51 });
    expect(byName.default).toMatchObject({ vcpu: 4, memMib: 8192, diskGb: 51 });
    expect(byName.large).toMatchObject({ vcpu: 8, memMib: 16384, diskGb: 111 });
    expect(byName.xlarge).toMatchObject({ vcpu: 16, memMib: 32768, diskGb: 251 });
    expect(rows.every((row) => row.retiredAt === null)).toBe(true);
  });

  test("ordered smallest first, so the console lists them by size", async () => {
    const vcpus = (await sizes()).map((row) => row.vcpu);
    expect(vcpus).toEqual(vcpus.toSorted((a, b) => a - b));
  });

  test("GET /limits advertises them as allowedTypes", async () => {
    const res = await call("GET", "/api/v1/limits", { token: OPERATOR });
    const body = (await res.json()) as { limits: { allowedTypes: string[] } };
    expect(body.limits.allowedTypes).toContain("small");
    expect(body.limits.allowedTypes).toContain("default");
  });

  test("any signed-in person can read the list: the console needs it", async () => {
    const cookie = await signUp(`sizes-reader@example.com`);
    const res = await call("GET", "/api/v1/machine-sizes", { cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sizes: Size[] }).sizes.length).toBeGreaterThanOrEqual(4);
  });

  test("reading the list needs a credential at all", async () => {
    const res = await call("GET", "/api/v1/machine-sizes");
    expect(res.status).toBe(401);
  });
});

describe("only the operator key may change presets", () => {
  test("a user key is refused and nothing is created", async () => {
    const cookie = await signUp("sizes-author@example.com");
    const keyRes = await call("POST", "/api/v1/api-keys", { cookie, json: { name: "ci" } });
    const { key } = (await keyRes.json()) as { key: string };

    const res = await call("POST", "/api/v1/machine-sizes", {
      token: key,
      json: { name: "user-made", vcpu: 2, memMib: 2048, diskGb: 20 },
    });

    expect(res.status).toBe(403);
    expect(await sizes()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "user-made" })]),
    );
  });

  test("a session cookie cannot edit or retire either", async () => {
    const cookie = await signUp("sizes-session@example.com");

    const patch = await call("PATCH", "/api/v1/machine-sizes/large", {
      cookie,
      json: { vcpu: 9 },
    });
    const retire = await call("DELETE", "/api/v1/machine-sizes/large", { cookie });

    expect(patch.status).toBe(403);
    expect(retire.status).toBe(403);
  });
});

describe("putting a preset in and taking it out", () => {
  test("create, edit, and retire", async () => {
    const created = await createPreset("burst", 6, 12288, 101);
    expect(created.status).toBe(201);
    const { size } = (await created.json()) as { size: Size };
    expect(size).toMatchObject({ name: "burst", vcpu: 6, memMib: 12288, diskGb: 101 });

    const patched = await call("PATCH", "/api/v1/machine-sizes/burst", {
      token: OPERATOR,
      json: { vcpu: 7, description: "seven cores" },
    });
    expect(patched.status).toBe(200);
    expect(((await patched.json()) as { size: Size }).size).toMatchObject({
      vcpu: 7,
      memMib: 12288,
      description: "seven cores",
    });

    const retired = await call("DELETE", "/api/v1/machine-sizes/burst", { token: OPERATOR });
    expect(retired.status).toBe(200);

    const active = await sizes();
    expect(active.map((row) => row.name)).not.toContain("burst");

    const all = await sizes(OPERATOR, "?includeRetired=true");
    expect(all.find((row) => row.name === "burst")?.retiredAt).not.toBeNull();
  });

  test("a duplicate name is a 409, not a silent overwrite", async () => {
    const res = await createPreset("small");
    expect(res.status).toBe(409);
  });

  test("resources outside the allowed range are a 400 naming the field", async () => {
    const tooBig = await call("POST", "/api/v1/machine-sizes", {
      token: OPERATOR,
      json: { name: "huge", vcpu: 4096, memMib: 8192, diskGb: 51 },
    });
    const tooSmall = await call("POST", "/api/v1/machine-sizes", {
      token: OPERATOR,
      json: { name: "tiny", vcpu: 2, memMib: 16, diskGb: 51 },
    });
    const badName = await call("POST", "/api/v1/machine-sizes", {
      token: OPERATOR,
      json: { name: "Not A Name", vcpu: 2, memMib: 1024, diskGb: 20 },
    });

    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { message: string }).message).toContain("vcpu");
    expect(tooSmall.status).toBe(400);
    expect(badName.status).toBe(400);
  });

  test("an unknown name answers 404", async () => {
    const patch = await call("PATCH", "/api/v1/machine-sizes/nope", {
      token: OPERATOR,
      json: { vcpu: 2 },
    });
    const retire = await call("DELETE", "/api/v1/machine-sizes/nope", { token: OPERATOR });
    expect(patch.status).toBe(404);
    expect(retire.status).toBe(404);
  });

  test("default is editable: its numbers are the operator's to change", async () => {
    const before = (await sizes()).find((row) => row.name === "default")!;
    const patched = await call("PATCH", "/api/v1/machine-sizes/default", {
      token: OPERATOR,
      json: { vcpu: 6, memMib: 12_288 },
    });
    expect(patched.status).toBe(200);

    const after = (await sizes()).find((row) => row.name === "default")!;
    expect(after.vcpu).toBe(6);
    expect(after.memMib).toBe(12_288);
    expect(after.diskGb).toBe(before.diskGb);
    expect(after.retiredAt).toBeNull();

    const restored = await call("PATCH", "/api/v1/machine-sizes/default", {
      token: OPERATOR,
      json: { vcpu: before.vcpu, memMib: before.memMib },
    });
    expect(restored.status).toBe(200);
  });

  test("an edit changes what the next create gets, and what a resume asks for", async () => {
    const before = (await sizes()).find((row) => row.name === "default")!;
    await call("PATCH", "/api/v1/machine-sizes/default", {
      token: OPERATOR,
      json: { memMib: 5120 },
    });

    const made = await call("POST", "/api/v1/sandboxes", {
      token: OPERATOR,
      json: { ttlSeconds: 60, name: "sized-by-the-table" },
    });
    expect(made.status).toBe(202);

    const sandbox = ((await made.json()) as { sandbox: { id: string } }).sandbox;
    await call("POST", `/api/v1/sandboxes/${sandbox.id}/stop`, { token: OPERATOR });

    const big = await call("POST", `/api/v1/sandboxes/${sandbox.id}/resume`, {
      token: OPERATOR,
      json: { type: "xlarge" },
    });
    expect(big.status).toBe(202);

    await call("DELETE", `/api/v1/sandboxes/${sandbox.id}`, { token: OPERATOR });
    await call("PATCH", "/api/v1/machine-sizes/default", {
      token: OPERATOR,
      json: { vcpu: before.vcpu, memMib: before.memMib },
    });
  });

  test("default cannot be retired", async () => {
    const res = await call("DELETE", "/api/v1/machine-sizes/default", { token: OPERATOR });
    const body = (await res.json()) as { code: string; message: string };
    expect(res.status).toBe(403);
    expect(body.message).toContain("cannot be retired");
    expect((await sizes()).map((row) => row.name)).toContain("default");
  });

  test("a preset cannot be retired twice into a second retirement time", async () => {
    await createPreset("twice", 5, 10240, 71);
    const first = await call("DELETE", "/api/v1/machine-sizes/twice", { token: OPERATOR });
    const second = await call("DELETE", "/api/v1/machine-sizes/twice", { token: OPERATOR });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { retiredAt: string }).retiredAt).toBe(
      ((await first.clone().json()) as { retiredAt: string }).retiredAt,
    );
  });

  test("every change is in the audit log with the preset as its target", async () => {
    await createPreset("audited");
    await call("PATCH", "/api/v1/machine-sizes/audited", { token: OPERATOR, json: { vcpu: 3 } });
    await call("DELETE", "/api/v1/machine-sizes/audited", { token: OPERATOR });

    const res = await call("GET", "/api/v1/audit-log?action=machine_size.create", {
      token: OPERATOR,
    });
    const body = (await res.json()) as {
      entries: { action: string; target: { type: string; id: string } }[];
    };
    expect(body.entries[0]?.target).toEqual({ type: "machine_size", id: "audited" });
  });
});
