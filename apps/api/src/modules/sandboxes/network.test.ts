import { describe, expect, test } from "bun:test";
import { app } from "../../app.ts";

const KEY = "test_key";

function call(method: string, path: string, json?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${KEY}` };
  const init: RequestInit = { method, headers };

  if (json !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(json);
  }

  return app.request(path, init);
}

describe("per-sandbox network policy", () => {
  test("create with deny and allow policies persists and reads via GET /network", async () => {
    const deniedRes = await call("POST", "/api/v1/sandboxes", {
      name: "net-deny",
      wait: true,
      network: { mode: "deny" },
    });
    expect(deniedRes.status).toBe(201);
    const { sandbox: denied } = (await deniedRes.json()) as {
      sandbox: { id: string; network: { mode: string; allow: string[] } | null };
    };
    expect(denied.network).toEqual({ mode: "deny", allow: [] });

    const deniedNet = (await (
      await call("GET", `/api/v1/sandboxes/${denied.id}/network`)
    ).json()) as { ok: true; type: string; network: { mode: string; allow: string[] } };
    expect(deniedNet).toEqual({
      ok: true,
      type: "sandbox.network",
      network: { mode: "deny", allow: [] },
    });

    const allowRes = await call("POST", "/api/v1/sandboxes", {
      name: "net-allow",
      wait: true,
      network: { mode: "allow", allow: ["GitHub.com", "*.npmjs.org", "1.1.1.1/32"] },
    });
    expect(allowRes.status).toBe(201);
    const { sandbox: allowed } = (await allowRes.json()) as {
      sandbox: { id: string; network: { mode: string; allow: string[] } | null };
    };
    expect(allowed.network).toEqual({
      mode: "allow",
      allow: ["github.com", "*.npmjs.org", "1.1.1.1/32"],
    });
  });

  test("sandbox without explicit network defaults to mode 'default' on GET /network", async () => {
    const res = await call("POST", "/api/v1/sandboxes", { name: "net-default", wait: true });
    expect(res.status).toBe(201);
    const { sandbox } = (await res.json()) as { sandbox: { id: string } };

    const net = (await (await call("GET", `/api/v1/sandboxes/${sandbox.id}/network`)).json()) as {
      network: { mode: string; allow: string[] };
    };
    expect(net.network).toEqual({ mode: "default", allow: [] });
  });

  test("invalid policies and private/reserved IPs are rejected with 400", async () => {
    const invalid: unknown[] = [
      { mode: "allow", allow: [] },
      { mode: "deny", allow: ["github.com"] },
      { mode: "allow", allow: ["https://github.com"] },
      { mode: "allow", allow: ["github.com:443"] },
      { mode: "allow", allow: ["*.com"] },
      { mode: "allow", allow: ["192.168.1.10"] },
      { mode: "allow", allow: ["10.0.0.0/8"] },
      { mode: "allow", allow: ["100.64.0.5"] },
      { mode: "allow", allow: ["127.0.0.1"] },
      { mode: "allow", allow: ["0.0.0.0/0"] },
      { mode: "allow", allow: ["::1"] },
      { mode: "allow", allow: ["fd00::1"] },
    ];

    for (const network of invalid) {
      const res = await call("POST", "/api/v1/sandboxes", { network });
      expect({ network, status: res.status }).toEqual({ network, status: 400 });
    }
  });

  test("fork inherits parent network policy and refuses conflicting override with 409", async () => {
    const srcRes = await call("POST", "/api/v1/sandboxes", {
      name: "net-parent",
      wait: true,
      network: { mode: "deny" },
    });
    expect(srcRes.status).toBe(201);
    const { sandbox: parent } = (await srcRes.json()) as { sandbox: { id: string } };

    const forkRes = await call("POST", `/api/v1/sandboxes/${parent.id}/fork`, {});
    expect(forkRes.status).toBe(202);
    const { sandbox: child } = (await forkRes.json()) as {
      sandbox: { id: string; network: { mode: string; allow: string[] } | null };
    };
    expect(child.network).toEqual({ mode: "deny", allow: [] });

    const conflict = await call("POST", `/api/v1/sandboxes/${parent.id}/fork`, {
      network: { mode: "open" },
    });
    expect(conflict.status).toBe(409);
    const body = (await conflict.json()) as { code: string };
    expect(body.code).toBe("network_policy_unsupported");
  });
});
