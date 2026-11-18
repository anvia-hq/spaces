import { OPERATOR_KEY, agentFor, eventually, serveControlPlane } from "./control-plane.ts";

export type RuntimeView = {
  id: string;
  name: string;
  state: string;
  draining: boolean;
  driver: string | null;
  publicHost: string | null;
  agentVersion: string | null;
  connectedAt: string | null;
  activeSandboxes: number;
  maxSandboxes: number | null;
  resources: { vcpu: number; memMib: number } | null;
  committed: { vcpu: number; memMib: number };
};

export async function startFleet() {
  const { app, server, url } = await serveControlPlane();
  const stoppers: (() => Promise<void>)[] = [];
  let sequence = 0;

  function unique(prefix: string): string {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36).slice(-4)}${sequence}`;
  }

  async function call(method: string, path: string, json?: unknown) {
    const headers: Record<string, string> = { authorization: `Bearer ${OPERATOR_KEY}` };

    if (json !== undefined) headers["content-type"] = "application/json";

    return app.request(path, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  }

  async function register(name: string, json: Record<string, unknown> = {}) {
    const res = await call("POST", "/api/v1/runtimes", { name, ...json });
    const body = (await res.json()) as { runtime: RuntimeView; token: string };
    return { id: body.runtime.id, name, token: body.token };
  }

  async function runtimeView(reference: string): Promise<RuntimeView> {
    const res = await call("GET", `/api/v1/runtimes/${reference}`);
    return ((await res.json()) as { runtime: RuntimeView }).runtime;
  }

  async function online(
    prefix: string,
    options: Partial<Parameters<typeof agentFor>[0]> & { cap?: number } = {},
  ) {
    const registered = await register(
      unique(prefix),
      options.cap ? { maxSandboxes: options.cap } : {},
    );
    const started = agentFor({ url, token: registered.token, ...options });
    stoppers.push(() => started.agent.stop());
    await started.agent.connected;
    await eventually(
      () => runtimeView(registered.id),
      (view) => view.state === "online",
    );

    return { ...registered, ...started };
  }

  async function sandboxState(id: string): Promise<string> {
    const res = await call("GET", `/api/v1/sandboxes/${id}`);
    return ((await res.json()) as { sandbox: { state: string } }).sandbox.state;
  }

  async function createOn(runtime: string | undefined, extra: Record<string, unknown> = {}) {
    const request: Record<string, unknown> = { ...extra };

    if (runtime) request.runtime = runtime;

    const res = await call("POST", "/api/v1/sandboxes", request);
    const body = (await res.json()) as {
      sandbox?: { id: string; runtimeId: string };
      code?: string;
      message?: string;
    };

    if (res.status === 202) {
      await eventually(
        () => sandboxState(body.sandbox!.id),
        (state) => state === "ready",
      );
    }

    return { res, body, id: body.sandbox?.id ?? "", runtimeId: body.sandbox?.runtimeId ?? "" };
  }

  async function shutdown() {
    for (const stop of stoppers) await stop();

    server.stop(true);
  }

  return {
    app,
    url,
    unique,
    call,
    register,
    runtimeView,
    online,
    sandboxState,
    createOn,
    shutdown,
    track: (stop: () => Promise<void>) => stoppers.push(stop),
  };
}
