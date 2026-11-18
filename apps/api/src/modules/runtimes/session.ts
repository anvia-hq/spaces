import {
  AgentFrame,
  HEARTBEAT_MISSES,
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  decodeFrame,
  type AgentHello,
} from "@spaces/shared/runtime";
import type { RuntimeRow } from "../../db.ts";
import { attachDriver, detachDriver } from "../driver/service.ts";
import { remoteDriver } from "../driver/remote.ts";
import {
  AgentConnection,
  allConnections,
  registerConnection,
  unregisterConnection,
} from "./connections.ts";
import { markRuntimeOffline, markRuntimeOnline, touchRuntime } from "./service.ts";
import type { ConnectionSocket } from "./types.ts";

const HELLO_TIMEOUT_MS = 10_000;

export function openSession(runtime: RuntimeRow, socket: ConnectionSocket) {
  let connection: AgentConnection | null = null;
  let queue: Promise<void> = Promise.resolve();

  const helloTimer = setTimeout(() => {
    if (!connection) socket.close(4408, "no hello within the handshake window");
  }, HELLO_TIMEOUT_MS);

  async function handshake(hello: AgentHello): Promise<void> {
    if (hello.protocol !== PROTOCOL_VERSION) {
      socket.close(
        1008,
        `protocol mismatch: the agent speaks ${hello.protocol}, the control plane speaks ${PROTOCOL_VERSION}`,
      );
      return;
    }

    const next = new AgentConnection(runtime.id, runtime.name, socket);
    const attached = attachDriver(
      runtime.id,
      remoteDriver(next, { kind: hello.driver, capabilities: hello.capabilities }),
      runtime.name,
    );
    next.onClosed = () => {
      const current = unregisterConnection(next);
      detachDriver(runtime.id, attached);

      if (current) void markRuntimeOffline(runtime.id).catch(() => undefined);
    };

    connection = next;
    registerConnection(next)?.shutdown("replaced by a newer connection");

    try {
      await markRuntimeOnline(runtime.id, hello);
    } catch {
      next.shutdown("could not record the connection");
      return;
    }

    next.send({
      t: "welcome",
      runtimeId: runtime.id,
      protocol: PROTOCOL_VERSION,
      heartbeatMs: HEARTBEAT_MS,
    });
  }

  async function dispatch(frame: AgentFrame): Promise<void> {
    if (!connection) {
      if (frame.t !== "hello") return socket.close(1002, "expected hello first");

      return handshake(frame);
    }

    if (frame.t === "heartbeat") {
      connection.lastSeenAt = Date.now();
      void touchRuntime(runtime.id).catch(() => undefined);
      return;
    }

    connection.receive(frame);
  }

  return {
    onMessage(text: string): void {
      let parsed: ReturnType<typeof AgentFrame.safeParse>;
      try {
        parsed = AgentFrame.safeParse(decodeFrame(text));
      } catch {
        socket.close(1003, "frames are JSON");
        return;
      }

      if (!parsed.success) {
        socket.close(1003, "malformed frame");
        return;
      }

      const frame = parsed.data;
      queue = queue.then(() => dispatch(frame)).catch(() => undefined);
    },
    onClose(): void {
      clearTimeout(helloTimer);
      connection?.close("socket closed");
    },
  };
}

export function sweepLiveness(nowMs: number = Date.now()): string[] {
  const limit = HEARTBEAT_MS * HEARTBEAT_MISSES;
  const stale = allConnections().filter((connection) => nowMs - connection.lastSeenAt > limit);

  for (const connection of stale) connection.shutdown("no heartbeat");

  return stale.map((connection) => connection.runtimeId);
}
