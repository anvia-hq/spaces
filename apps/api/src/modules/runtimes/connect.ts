import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { MAX_FRAME_BYTES, RUNTIME_PATH } from "@spaces/shared/runtime";
import { fail, type ApiEnv } from "../../errors.ts";
import { authenticateAgent } from "./service.ts";
import { openSession } from "./session.ts";

const bun = createBunWebSocket();

export const runtimeWebsocket = { ...bun.websocket, maxPayloadLength: MAX_FRAME_BYTES };

export const connectRouter = new Hono<ApiEnv>().get(
  RUNTIME_PATH,
  async (c, next) => {
    const token = (c.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const runtime = await authenticateAgent(token);

    if (!runtime) return fail(c, "unauthorized", "Unknown or revoked runtime token.");

    c.set("agentRuntime", runtime);
    return next();
  },
  bun.upgradeWebSocket((c) => {
    let session: ReturnType<typeof openSession> | null = null;

    return {
      onOpen: (_event, ws) => {
        const runtime = c.get("agentRuntime");

        if (!runtime) return ws.close(1008, "unauthorized");

        session = openSession(runtime, {
          send: (text) => ws.send(text),
          close: (code, reason) => ws.close(code, reason),
        });
      },
      onMessage: (event) => {
        if (typeof event.data === "string") session?.onMessage(event.data);
      },
      onClose: () => session?.onClose(),
    };
  }),
);
