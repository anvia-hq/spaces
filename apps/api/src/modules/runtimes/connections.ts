import {
  CALL_TIMEOUT_MS,
  MAX_CALL_FRAME_CHARS,
  ProxyHead,
  encodeFrame,
  type AgentFrame,
  type DriverMethod,
  type WireError,
} from "@spaces/shared/runtime";
import {
  DriverFailure,
  DriverUnsupported,
  RuntimeUnavailable,
  ServiceError,
} from "../../errors.ts";
import type { DriverTransport, ProxyResponse } from "../driver/types.ts";
import type { ConnectionSocket } from "./types.ts";

interface Pending {
  method: DriverMethod;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function attempt(action: () => void): boolean {
  try {
    action();
    return true;
  } catch {
    return false;
  }
}

function revive(error: WireError): Error {
  if (error.name === "DriverUnsupported") {
    const revived = new DriverUnsupported(error.operation ?? "operation", error.reason ?? "");
    revived.message = error.message;
    return revived;
  }

  if (error.name === "DriverFailure") return new DriverFailure(error.message, error.detail);

  return new Error(error.message);
}

export class AgentConnection implements DriverTransport {
  lastSeenAt = Date.now();
  closed = false;
  onClosed: (() => void) | null = null;

  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly streams = new Map<number, ReadableStreamDefaultController<Uint8Array>>();

  constructor(
    readonly runtimeId: string,
    readonly label: string,
    private readonly socket: ConnectionSocket,
    private readonly callTimeoutMs: number = CALL_TIMEOUT_MS,
  ) {}

  send(frame: unknown): void {
    this.socket.send(encodeFrame(frame));
  }

  call(method: DriverMethod, args: unknown[]): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new RuntimeUnavailable(`runtime ${this.label} is offline`));
    }

    const id = this.nextId++;
    const text = encodeFrame({ t: "call", id, method, args });

    if (text.length > MAX_CALL_FRAME_CHARS) {
      const limit = Math.floor((MAX_CALL_FRAME_CHARS / 1024 / 1024) * 0.75);

      return Promise.reject(
        new ServiceError(
          "file_too_large",
          `file_too_large: a call to a runtime carries at most about ${limit} MiB of data`,
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new RuntimeUnavailable(
            `runtime ${this.label} did not answer ${method} within ${Math.round(this.callTimeoutMs / 1000)}s`,
          ),
        );
      }, this.callTimeoutMs);

      this.pending.set(id, { method, resolve, reject, timer });

      try {
        this.socket.send(text);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RuntimeUnavailable(`runtime ${this.label} is unreachable: ${String(error)}`));
      }
    });
  }

  receive(frame: AgentFrame): void {
    this.lastSeenAt = Date.now();

    if (frame.t === "heartbeat" || frame.t === "hello") return;

    if (frame.t === "result") return this.settle(frame);

    const controller = this.streams.get(frame.id);

    if (!controller) return;

    if (frame.t === "chunk") {
      if (frame.data instanceof Uint8Array) controller.enqueue(frame.data);

      return;
    }

    this.streams.delete(frame.id);

    if (frame.t === "end") {
      controller.close();
      return;
    }

    controller.error(new DriverFailure(frame.message));
  }

  close(reason: string): void {
    if (this.closed) return;

    this.closed = true;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new RuntimeUnavailable(`runtime ${this.label} went offline: ${reason}`));
      this.pending.delete(id);
    }

    for (const [id, controller] of this.streams) {
      controller.error(new DriverFailure(`runtime ${this.label} went offline: ${reason}`));
      this.streams.delete(id);
    }

    this.onClosed?.();
  }

  shutdown(reason: string): void {
    this.close(reason);

    attempt(() => this.socket.close(1000, reason));
  }

  private settle(frame: Extract<AgentFrame, { t: "result" }>): void {
    const pending = this.pending.get(frame.id);

    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(frame.id);

    if (!frame.ok) return pending.reject(revive(frame.error));

    if (pending.method !== "proxyHttp") return pending.resolve(frame.value);

    const head = ProxyHead.safeParse(frame.value);

    if (!head.success) {
      return pending.reject(new DriverFailure("runtime answered a proxy call without a head"));
    }

    const { status, statusText, headers, hasBody } = head.data;
    const body = hasBody ? this.openStream(frame.id) : null;
    const response: ProxyResponse = { status, statusText, headers, body };
    pending.resolve(response);
  }

  private openStream(id: number): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.streams.set(id, controller);
      },
      cancel: () => {
        if (!this.streams.delete(id) || this.closed) return;

        attempt(() => this.send({ t: "cancel", id }));
      },
    });
  }
}

const connections = new Map<string, AgentConnection>();

export function connectionOf(runtimeId: string): AgentConnection | null {
  return connections.get(runtimeId) ?? null;
}

export function connectedRuntimeIds(): string[] {
  return [...connections.keys()];
}

export function allConnections(): AgentConnection[] {
  return [...connections.values()];
}

export function registerConnection(connection: AgentConnection): AgentConnection | null {
  const replaced = connections.get(connection.runtimeId) ?? null;
  connections.set(connection.runtimeId, connection);

  return replaced;
}

export function unregisterConnection(connection: AgentConnection): boolean {
  if (connections.get(connection.runtimeId) !== connection) return false;

  connections.delete(connection.runtimeId);

  return true;
}

export function closeConnection(runtimeId: string, reason: string): void {
  connections.get(runtimeId)?.shutdown(reason);
}
