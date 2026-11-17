import { afterEach, describe, expect, test } from "bun:test";

const { app } = await import("../../app.ts");
const { config } = await import("../../config.ts");
const { store } = await import("../../db.ts");
const { operatorScope, runInScope } = await import("../../scope.ts");
const { mockRestores } = await import("../driver/mock.ts");

type Credential = { token: string } | { cookie: string };

const operator: Credential = { token: "test_key" };
const PASSWORD = "correct-horse-battery";

const trackedSandboxes: string[] = [];
const trackedSavedNames: string[] = [];
const trackedSnapshotIds: string[] = [];

let sequence = 0;

function unique(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

function trackSandbox(id: string) {
  trackedSandboxes.push(id);
}

function trackSaved(name: string) {
  trackedSavedNames.push(name);
}

function trackSnapshot(id: string) {
  trackedSnapshotIds.push(id);
}

async function call(
  method: string,
  path: string,
  options: { json?: unknown; credential?: Credential } = {},
) {
  const headers: Record<string, string> = { origin: config.auth.url };
  const credential = options.credential ?? operator;

  if ("token" in credential) headers.authorization = `Bearer ${credential.token}`;
  else headers.cookie = credential.cookie;

  if (options.json !== undefined) headers["content-type"] = "application/json";

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

async function signUp(email: string): Promise<Credential> {
  const res = await call("POST", "/api/auth/sign-up/email", {
    json: { email, password: PASSWORD, name: email.split("@")[0] },
  });
  expect(res.status).toBe(200);
  return { cookie: cookieOf(res) };
}

async function createSandbox(
  json: Record<string, unknown>,
  credential: Credential,
): Promise<{
  id: string;
  res: Response;
  body: { sandbox?: { id?: string; state?: string } };
}> {
  const res = await call("POST", "/api/v1/sandboxes", { json, credential });
  const body = (await res.json()) as { sandbox?: { id?: string; state?: string } };
  const id = body.sandbox?.id;

  if (id) trackSandbox(id);

  return { id: id ?? "", res, body };
}

async function waitFor(
  id: string,
  states: string[],
  credential: Credential = operator,
  timeoutMs = 6000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let last = "";

  while (Date.now() < deadline) {
    const res = await call("GET", `/api/v1/sandboxes/${id}`, { credential });
    const body = (await res.json()) as { sandbox?: { state?: string } };
    last = body.sandbox?.state ?? "";

    if (states.includes(last)) return last;

    await Bun.sleep(25);
  }

  throw new Error(`sandbox ${id} stuck in ${last}, wanted ${states.join("|")}`);
}

async function readySandbox(credential: Credential = operator): Promise<string> {
  const { id, res } = await createSandbox({}, credential);
  expect(res.status).toBe(202);
  await waitFor(id, ["ready", "running"], credential);
  return id;
}

async function saveSnapshot(sandboxId: string, name: string, credential: Credential = operator) {
  const res = await call("POST", "/api/v1/saved-snapshots", {
    json: { sandboxId, name },
    credential,
  });
  expect(res.status).toBe(202);
  trackSaved(name);
  const body = (await res.json()) as {
    snapshot: { name: string; status: string; snapshotId?: string; sizeBytes?: number };
  };

  if (body.snapshot.snapshotId) trackSnapshot(body.snapshot.snapshotId);

  return body.snapshot;
}

async function savedSnapshot(name: string, credential: Credential = operator) {
  const res = await call("GET", `/api/v1/saved-snapshots/${name}`, { credential });
  const body = (await res.json()) as {
    snapshot?: { name: string; status: string; snapshotId?: string };
  };
  return { res, snapshot: body.snapshot };
}

async function sandboxCount(credential: Credential = operator): Promise<number> {
  const res = await call("GET", "/api/v1/sandboxes", { credential });
  const body = (await res.json()) as { sandboxes?: unknown[] };
  return body.sandboxes?.length ?? 0;
}

async function seedSaved(
  name: string,
  saved: { status: "saving" | "ready" | "failed"; snapshotId?: string; error?: string },
) {
  await runInScope(operatorScope, () =>
    store.upsertSavedSnapshot({
      name,
      status: saved.status,
      error: saved.error ?? null,
      sourceSandboxId: "bx_22222222",
      snapshotId: saved.snapshotId ?? null,
      createdAt: new Date().toISOString(),
    }),
  );
  trackSaved(name);
}

async function seedArtifact(
  id: string,
  state: "creating" | "ready" | "error",
  driverRef: string | null,
) {
  await runInScope(operatorScope, () =>
    store.insertSnapshot({
      id,
      sandboxId: "bx_22222222",
      name: null,
      state,
      driverRef,
    }),
  );
  trackSnapshot(id);
}

afterEach(async () => {
  for (const id of trackedSandboxes.splice(0).reverse()) {
    await call("DELETE", `/api/v1/sandboxes/${id}`).catch(() => {});
  }

  await runInScope(operatorScope, async () => {
    for (const name of trackedSavedNames.splice(0).reverse()) {
      await store.deleteSharesOf(name);
      await store.deleteSavedSnapshot(name);
    }

    for (const id of trackedSnapshotIds.splice(0).reverse()) {
      await store.removeSnapshot(id);
    }
  });
});

describe("creating a sandbox from a saved snapshot", () => {
  test("a ready saved snapshot boots a new sandbox from its disk", async () => {
    const sourceId = await readySandbox();
    const name = unique("ready");
    const saved = await saveSnapshot(sourceId, name);
    expect(saved.status).toBe("ready");
    expect(saved.sizeBytes).toBe(4 * 1024 ** 3);
    const snapshotId = saved.snapshotId!;

    const { id, res, body } = await createSandbox(
      { from: name, type: "small", env: { FOO: "bar" } },
      operator,
    );
    expect(res.status).toBe(202);
    expect(body.sandbox?.id).not.toBe(sourceId);
    expect(body.sandbox?.state).toBe("provisioning");

    expect(await waitFor(id, ["ready"])).toBe("ready");
    expect(mockRestores.find((restore) => restore.sandboxId === id)?.fromRef).toBe(
      `mock://snap/${snapshotId}`,
    );

    const row = (await (await call("GET", `/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { type: string };
    };
    expect(row.sandbox.type).toBe("small");
    expect(await runInScope(operatorScope, () => store.env(id))).toEqual({ FOO: "bar" });

    const stillSaved = await savedSnapshot(name);
    expect(stillSaved.snapshot?.status).toBe("ready");
    expect(stillSaved.snapshot?.snapshotId).toBe(snapshotId);

    const stop = await call("POST", `/api/v1/sandboxes/${id}/stop`, { json: {} });
    expect([200, 202]).toContain(stop.status);
    await waitFor(id, ["archived"]);
    const resume = await call("POST", `/api/v1/sandboxes/${id}/resume`, { json: {} });
    expect(resume.status).toBe(202);
    await waitFor(id, ["ready"]);
  });

  test("a live sandbox id is still a from source", async () => {
    const sourceId = await readySandbox();
    const { id, res } = await createSandbox({ from: sourceId }, operator);
    expect(res.status).toBe(202);
    expect(id).not.toBe(sourceId);
    expect(await waitFor(id, ["ready"])).toBe("ready");
    expect(mockRestores.some((restore) => restore.sandboxId === id)).toBe(false);
  });

  test("an unknown source is a 404 and creates nothing", async () => {
    const before = await sandboxCount();
    const res = await call("POST", "/api/v1/sandboxes", {
      json: { from: unique("missing") },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("snapshot_not_found");
    expect(await sandboxCount()).toBe(before);
  });

  test("a share code is not a create source", async () => {
    const sourceId = await readySandbox();
    const name = unique("shared");
    await saveSnapshot(sourceId, name);
    const share = await call("POST", `/api/v1/saved-snapshots/${name}/shares`);
    expect(share.status).toBe(201);
    const { shareCode } = (await share.json()) as { shareCode: string };

    const before = await sandboxCount();
    const res = await call("POST", "/api/v1/sandboxes", { json: { from: shareCode } });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("snapshot_not_found");
    expect(await sandboxCount()).toBe(before);
  });

  test("a saved snapshot that is not ready is refused", async () => {
    for (const status of ["saving", "failed"] as const) {
      const name = unique(`not-ready-${status}`);
      await seedSaved(name, {
        status,
        error: status === "failed" ? "disk full" : undefined,
      });

      const before = await sandboxCount();
      const res = await call("POST", "/api/v1/sandboxes", { json: { from: name } });
      expect({ status, http: res.status }).toEqual({ status, http: 409 });
      const body = (await res.json()) as { code: string; message: string };
      expect(body.code).toBe("sandbox_not_ready");
      expect(body.message).toContain("snapshot_not_ready");

      if (status === "failed") expect(body.message).toContain("disk full");

      expect(await sandboxCount()).toBe(before);
    }
  });

  test("a saved snapshot without a usable artifact is refused", async () => {
    const cases: {
      label: string;
      expected: number;
      message: string;
      seed: () => Promise<string>;
    }[] = [
      {
        label: "no snapshot id",
        expected: 404,
        message: "has no stored artifact",
        seed: async () => {
          const name = unique("no-id");
          await seedSaved(name, { status: "ready" });
          return name;
        },
      },
      {
        label: "missing artifact",
        expected: 404,
        message: "points at a missing artifact",
        seed: async () => {
          const name = unique("dangling");
          await seedSaved(name, { status: "ready", snapshotId: "sn_missing" });
          return name;
        },
      },
      {
        label: "artifact still creating",
        expected: 409,
        message: "artifact that is creating",
        seed: async () => {
          const artifactId = `sn_${unique("creating").replaceAll("-", "")}`;
          await seedArtifact(artifactId, "creating", null);
          const name = unique("artifact-creating");
          await seedSaved(name, { status: "ready", snapshotId: artifactId });
          return name;
        },
      },
      {
        label: "artifact without a driver ref",
        expected: 404,
        message: "has no stored artifact",
        seed: async () => {
          const artifactId = `sn_${unique("noref").replaceAll("-", "")}`;
          await seedArtifact(artifactId, "ready", null);
          const name = unique("artifact-no-ref");
          await seedSaved(name, { status: "ready", snapshotId: artifactId });
          return name;
        },
      },
    ];

    for (const item of cases) {
      const name = await item.seed();
      const before = await sandboxCount();
      const res = await call("POST", "/api/v1/sandboxes", { json: { from: name } });
      expect({ label: item.label, http: res.status }).toEqual({
        label: item.label,
        http: item.expected,
      });
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain(item.message);
      expect(await sandboxCount()).toBe(before);
    }
  });

  test("the saved snapshot survives creating, changing and deleting the new sandbox", async () => {
    const sourceId = await readySandbox();
    const name = unique("reusable");
    const saved = await saveSnapshot(sourceId, name);
    const snapshotId = saved.snapshotId!;

    const first = await createSandbox({ from: name }, operator);
    await waitFor(first.id, ["ready"]);

    const patched = await call("PATCH", `/api/v1/sandboxes/${first.id}`, {
      json: { name: "changed-after-restore", labels: { stage: "changed" } },
    });
    expect(patched.status).toBe(200);
    const removed = await call("DELETE", `/api/v1/sandboxes/${first.id}`);
    expect(removed.status).toBe(200);

    const second = await createSandbox({ from: name }, operator);
    expect(second.res.status).toBe(202);
    expect(second.id).not.toBe(first.id);
    await waitFor(second.id, ["ready"]);

    const restores = mockRestores.filter((restore) => restore.sandboxId === second.id);
    expect(restores.map((restore) => restore.fromRef)).toEqual([`mock://snap/${snapshotId}`]);

    const stillSaved = await savedSnapshot(name);
    expect(stillSaved.res.status).toBe(200);
    expect(stillSaved.snapshot?.status).toBe("ready");
    expect(stillSaved.snapshot?.snapshotId).toBe(snapshotId);
  });

  test("the new sandbox outlives the saved snapshot it came from", async () => {
    const sourceId = await readySandbox();
    const name = unique("deleted-after");
    await saveSnapshot(sourceId, name);

    const { id } = await createSandbox({ from: name }, operator);
    await waitFor(id, ["ready"]);

    const removed = await call("DELETE", `/api/v1/saved-snapshots/${name}`);
    expect(removed.status).toBe(200);

    const exec = await call("POST", `/api/v1/sandboxes/${id}/commands`, {
      json: { command: "echo alive" },
    });
    expect(exec.status).toBe(200);
    const result = (await exec.json()) as { exitCode: number; stdout: string };
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("alive");
  });

  test("another account's saved snapshot is refused", async () => {
    const owner = await signUp(`${unique("owner")}@example.com`);
    const stranger = await signUp(`${unique("stranger")}@example.com`);

    const sourceId = await readySandbox(owner);
    const name = unique("owned");
    await saveSnapshot(sourceId, name, owner);

    const hidden = await savedSnapshot(name, stranger);
    expect(hidden.res.status).toBe(404);

    const before = await sandboxCount(stranger);
    const denied = await call("POST", "/api/v1/sandboxes", {
      json: { from: name },
      credential: stranger,
    });
    expect(denied.status).toBe(404);
    const body = (await denied.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("snapshot_not_found");
    expect(await sandboxCount(stranger)).toBe(before);

    const allowed = await createSandbox({ from: name }, owner);
    expect(allowed.res.status).toBe(202);
    await waitFor(allowed.id, ["ready"], owner);
  });

  test("a restore that cannot find the disk errors the sandbox instead of cold booting", async () => {
    const artifactId = `sn_${unique("missing-disk").replaceAll("-", "")}`;
    await seedArtifact(artifactId, "ready", `mock://snap/${unique("gone")}`);
    const name = unique("broken");
    await seedSaved(name, { status: "ready", snapshotId: artifactId });

    const { id, res } = await createSandbox({ from: name }, operator);
    expect(res.status).toBe(202);
    expect(await waitFor(id, ["error"])).toBe("error");

    const row = (await (await call("GET", `/api/v1/sandboxes/${id}`)).json()) as {
      sandbox: { state: string; error: string | null };
    };
    expect(row.sandbox.error).toContain("no snapshot disk");
    expect(mockRestores.some((restore) => restore.sandboxId === id)).toBe(false);

    const stillSaved = await savedSnapshot(name);
    expect(stillSaved.snapshot?.status).toBe("ready");
  });
});
