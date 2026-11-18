import {
  ControlFrame,
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  RUNTIME_PATH,
  decodeFrame,
  encodeFrame,
  type DriverMethod,
  type WireError,
} from "@spaces/shared/runtime";
import { DriverFailure, DriverUnsupported } from "../../errors.ts";
import type { ProxyResponse } from "../driver/types.ts";
import type { AgentHandle, AgentOptions } from "./types.ts";

export function controlSocketUrl(controlUrl: string): string {
  const url = new URL(controlUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = RUNTIME_PATH;
  url.search = "";

  return url.toString();
}

export function wireErrorOf(error: unknown): WireError {
  if (error instanceof DriverUnsupported) {
    return {
      name: "DriverUnsupported",
      message: error.message,
      operation: error.operation,
      reason: error.reason,
    };
  }

  if (error instanceof DriverFailure) {
    const wire: WireError = { name: "DriverFailure", message: error.message };

    if (error.detail !== undefined) wire.detail = error.detail;

    return wire;
  }

  return { name: "Error", message: error instanceof Error ? error.message : String(error) };
}

export function startAgent(options: AgentOptions): AgentHandle {
  const log = options.log ?? (() => undefined);
  const backoff = options.backoff ?? { minMs: 1_000, maxMs: 30_000 };
  const url = controlSocketUrl(options.url);
  let stopped = false;
  let socket: WebSocket | null = null;
  let welcomed = false;
  let delay = backoff.minMs;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let resolveConnected: () => void = () => undefined;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  function connect(): void {
    if (stopped) return;

    const ws = new WebSocket(url, { headers: { authorization: `Bearer ${options.token}` } });
    socket = ws;
    welcomed = false;
    const cancels = new Map<number, () => void>();
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    const send = (frame: unknown) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(encodeFrame(frame));
    };

    ws.addEventListener("open", () => {
      send({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        agentVersion: options.version,
        driver: options.driver.kind,
        capabilities: options.driver.capabilities,
        resources: options.resources,
        portRange: options.portRange,
        portBind: options.portBind,
        publicHost: options.publicHost,
      });
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;

      let frame: ControlFrame;
      try {
        frame = ControlFrame.parse(decodeFrame(event.data));
      } catch {
        return;
      }

      if (frame.t === "welcome") {
        welcomed = true;
        delay = backoff.minMs;
        log(`connected to the control plane as runtime ${frame.runtimeId}`);
        resolveConnected();
        heartbeat = setInterval(
          () => send({ t: "heartbeat" }),
          Math.min(options.heartbeatMs ?? HEARTBEAT_MS, frame.heartbeatMs),
        );
        return;
      }

      if (frame.t === "cancel") {
        cancels.get(frame.id)?.();
        return;
      }

      void serve(frame.id, frame.method, frame.args);
    });

    async function serve(id: number, method: DriverMethod, args: unknown[]): Promise<void> {
      try {
        const method_ = options.driver[method] as (...inner: unknown[]) => Promise<unknown>;
        const value = await method_.apply(options.driver, args);

        if (method === "proxyHttp") return await relay(id, value as ProxyResponse);

        send({ t: "result", id, ok: true, value: value === undefined ? null : value });
      } catch (error) {
        send({ t: "result", id, ok: false, error: wireErrorOf(error) });
      }
    }

    async function relay(id: number, response: ProxyResponse): Promise<void> {
      send({
        t: "result",
        id,
        ok: true,
        value: {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          hasBody: response.body !== null,
        },
      });

      if (!response.body) return;

      const reader = response.body.getReader();
      cancels.set(id, () => void reader.cancel().catch(() => undefined));

      try {
        for (;;) {
          const { done, value } = await reader.read();

          if (done) break;

          send({ t: "chunk", id, data: value });
        }

        send({ t: "end", id });
      } catch (error) {
        send({ t: "abort", id, message: error instanceof Error ? error.message : String(error) });
      } finally {
        cancels.delete(id);
      }
    }

    ws.addEventListener("close", (event) => {
      if (heartbeat) clearInterval(heartbeat);

      for (const cancel of cancels.values()) cancel();

      cancels.clear();

      if (socket === ws) socket = null;

      if (stopped) return;

      log(
        `${welcomed ? "lost" : "could not open"} the control plane connection` +
          `${event.reason ? ` (${event.reason})` : ""}; retrying in ${Math.round(delay / 1000)}s`,
      );
      retry = setTimeout(connect, delay);
      delay = Math.min(delay * 2, backoff.maxMs);
    });

    ws.addEventListener("error", () => undefined);
  }

  connect();

  return {
    connected,
    isConnected: () => socket !== null && welcomed && socket.readyState === WebSocket.OPEN,
    async stop() {
      stopped = true;

      if (retry) clearTimeout(retry);

      socket?.close(1000, "agent stopped");
    },
  };
}
