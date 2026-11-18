const control = (process.env.SPACES_CONTROL_URL ?? "http://127.0.0.1:8787").replace(/\/+$/, "");
const operatorKey = process.env.SPACES_API_KEY ?? "sk_local_dev";
const runtimeName = `proof-${Date.now().toString(36)}`;
const root = new URL("..", import.meta.url).pathname;

type Step = { text: string };

const proven: Step[] = [];

function stamp(text: string): void {
  proven.push({ text });
  console.log(`  ok   ${text}`);
}

function refused(text: string): never {
  throw new Error(text);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${operatorKey}` };

  if (body !== undefined) headers["content-type"] = "application/json";

  const res = await fetch(`${control}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();

  if (!res.ok) refused(`${method} ${path} answered ${res.status}: ${text}`);

  return (text ? JSON.parse(text) : {}) as T;
}

async function waitFor<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs: number,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  const first = await read();

  if (done(first)) return first;

  while (Date.now() < deadline) {
    await Bun.sleep(500);

    const next = await read();

    if (done(next)) return next;
  }

  return refused(`gave up waiting for ${label}`);
}

type Runtime = { id: string; name: string; state: string };

type Sandbox = { id: string; state: string; runtimeId: string };

type Health = { ok: boolean; runtimes?: { online: number; total: number } };

async function readSandbox(id: string): Promise<Sandbox> {
  const answer = await call<{ sandbox: Sandbox }>("GET", `/api/v1/sandboxes/${id}`);

  return answer.sandbox;
}

async function readRuntime(id: string): Promise<Runtime> {
  const answer = await call<{ runtime: Runtime }>("GET", `/api/v1/runtimes/${id}`);

  return answer.runtime;
}

async function run(id: string, command: string): Promise<{ exitCode: number; stdout: string }> {
  return call<{ exitCode: number; stdout: string }>("POST", `/api/v1/sandboxes/${id}/commands`, {
    command,
  });
}

async function quiet(work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    console.warn("  skip: a cleanup step did not finish");
  }
}

const health = await call<Health>("GET", "/health");

if (!health.ok) refused("the control plane does not answer /health");

const registered = await call<{ runtime: Runtime; token: string }>("POST", "/api/v1/runtimes", {
  name: runtimeName,
  labels: { proof: "cluster" },
});

stamp(`registered runtime ${registered.runtime.name}`);

const agent = Bun.spawn({
  cmd: [process.execPath, "run", "apps/api/src/agent.ts"],
  cwd: root,
  env: {
    ...process.env,
    SPACES_CONTROL_URL: control,
    SPACES_RUNTIME_TOKEN: registered.token,
    SPACES_PORT_RANGE_START: "23000",
    SPACES_PORT_RANGE_END: "23999",
  },
  stdout: "pipe",
  stderr: "pipe",
});

const sandboxes: string[] = [];

try {
  const online = await waitFor(
    "the agent to connect",
    () => readRuntime(registered.runtime.id),
    (runtime) => runtime.state === "online",
    90_000,
  );

  stamp(`it dialled out and the control plane reports ${online.state}`);

  await call("PATCH", "/api/v1/runtimes/local", { draining: true });

  const made = await call<{ sandbox: Sandbox }>("POST", "/api/v1/sandboxes", {
    type: "small",
    ttlSeconds: 900,
  });

  sandboxes.push(made.sandbox.id);

  if (made.sandbox.runtimeId !== registered.runtime.id) {
    refused(`an unpinned create landed on ${made.sandbox.runtimeId}, not the new runtime`);
  }

  stamp("an unpinned create was placed on the machine that had just joined");

  const ready = await waitFor(
    "the sandbox to be ready",
    () => readSandbox(made.sandbox.id),
    (sandbox) => sandbox.state === "ready" || sandbox.state === "error",
    600_000,
  );

  if (ready.state !== "ready") refused(`the sandbox ended ${ready.state}`);

  const kernel = await run(made.sandbox.id, "uname -r > /tmp/proof-kernel && echo placed");

  if (kernel.exitCode !== 0) refused(`a command in the sandbox exited ${kernel.exitCode}`);

  stamp("it booted a real guest and ran a command in it");

  await call("POST", `/api/v1/sandboxes/${made.sandbox.id}/stop`, {});

  const archived = await readSandbox(made.sandbox.id);

  if (archived.state !== "archived") refused(`the stop left the sandbox ${archived.state}`);

  await call("POST", `/api/v1/sandboxes/${made.sandbox.id}/resume`, {});

  const back = await waitFor(
    "the sandbox to come back",
    () => readSandbox(made.sandbox.id),
    (sandbox) => sandbox.state === "ready" || sandbox.state === "error",
    600_000,
  );

  if (back.state !== "ready") refused(`the resume left the sandbox ${back.state}`);

  if (back.runtimeId !== registered.runtime.id) {
    refused(`resume moved the sandbox to ${back.runtimeId}`);
  }

  stamp("stop and resume kept it on the machine that holds its disk");

  const kept = await run(made.sandbox.id, "cat /tmp/proof-kernel");

  if (kept.stdout.trim() === "") refused("the file written before the stop is gone");

  stamp(`the file written before the stop survived: ${kept.stdout.trim()}`);
} finally {
  for (const id of sandboxes) await quiet(() => call("DELETE", `/api/v1/sandboxes/${id}`));

  await quiet(() => call("PATCH", "/api/v1/runtimes/local", { draining: false }));
  await quiet(() => call("DELETE", `/api/v1/runtimes/${registered.runtime.id}`));

  agent.kill();
}

console.log("");
console.log(`a cluster of two, proven on ${control}:`);

for (const step of proven) console.log(`  - ${step.text}`);

console.log("");
console.log(`health before: ${JSON.stringify(health.runtimes ?? null)}`);
