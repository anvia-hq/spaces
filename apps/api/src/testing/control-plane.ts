import type { FileEntry } from "@spaces/shared/files";
import { MockDriver } from "../modules/driver/mock.ts";
import type { ProxyRequest, ProxyResponse, SandboxDriver } from "../modules/driver/types.ts";
import { startAgent } from "../modules/runtime-agent/agent.ts";

export const OPERATOR_KEY = "test_key";

export async function serveControlPlane() {
  const { app } = await import("../app.ts");
  const { runtimeWebsocket } = await import("../modules/runtimes/connect.ts");
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: app.fetch,
    websocket: runtimeWebsocket,
  });

  return { app, server, url: `http://127.0.0.1:${server.port}` };
}

export class FixtureDriver extends MockDriver {
  readonly stored = new Map<string, Uint8Array>();
  readonly proxied: ProxyRequest[] = [];
  cancelledStreams = 0;
  chunks: string[] = ["alpha-", "beta-", "gamma"];

  override async fileInfo(_ref: string, path: string): Promise<FileEntry> {
    const bytes = this.stored.get(path);

    if (!bytes) throw new Error(`ENOENT: ${path}`);

    return {
      name: path.split("/").pop() ?? path,
      path,
      isDir: false,
      isSymlink: false,
      size: bytes.byteLength,
      mode: "0644",
      modifiedAt: new Date(0).toISOString(),
    };
  }

  override async readFile(_ref: string, path: string): Promise<Uint8Array> {
    const bytes = this.stored.get(path);

    if (!bytes) throw new Error(`ENOENT: ${path}`);

    return bytes;
  }

  override async writeFile(_ref: string, path: string, bytes: Uint8Array): Promise<void> {
    this.stored.set(path, bytes);
  }

  override async proxyHttp(request: ProxyRequest): Promise<ProxyResponse> {
    this.proxied.push(request);
    const queue = [...this.chunks];
    const encoder = new TextEncoder();
    const countCancel = () => {
      this.cancelledStreams += 1;
    };

    return {
      status: 201,
      statusText: "Created",
      headers: [
        ["content-type", "text/plain"],
        ["x-fixture", "yes"],
      ],
      body: new ReadableStream<Uint8Array>({
        async pull(controller) {
          const next = queue.shift();

          if (next === undefined) return controller.close();

          await Bun.sleep(5);
          controller.enqueue(encoder.encode(next));
        },
        cancel: countCancel,
      }),
    };
  }
}

export async function eventually<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last = await read();

  while (!accept(last) && Date.now() < deadline) {
    await Bun.sleep(20);
    last = await read();
  }

  if (!accept(last))
    throw new Error(`condition not met in ${timeoutMs}ms; last: ${JSON.stringify(last)}`);

  return last;
}

export function agentFor(options: {
  url: string;
  token: string;
  driver?: SandboxDriver;
  portRange?: { start: number; end: number } | null;
  resources?: { vcpu: number; memMib: number } | null;
  publicHost?: string | null;
  portBind?: string;
  heartbeatMs?: number;
}) {
  const driver = options.driver ?? new MockDriver();
  const agent = startAgent({
    url: options.url,
    token: options.token,
    driver,
    version: "test",
    resources: options.resources === undefined ? null : options.resources,
    portRange: options.portRange === undefined ? { start: 23000, end: 23020 } : options.portRange,
    portBind: options.portBind ?? "127.0.0.1",
    publicHost: options.publicHost === undefined ? null : options.publicHost,
    backoff: { minMs: 30, maxMs: 120 },
    heartbeatMs: options.heartbeatMs,
  });

  return { agent, driver };
}
