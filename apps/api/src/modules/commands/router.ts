import { Hono } from "hono";
import { CommandRequest } from "@spaces/shared/sandbox";
import { type ApiEnv, validate } from "../../errors.ts";
import { CommandLogsQuery, CommandsAttachQuery, CommandsStatusQuery } from "./schema.ts";
import { requireSandbox } from "../sandboxes/service.ts";
import {
  assertRunnable,
  commandHistoryInfo,
  commandHistoryLogs,
  killSandboxProcess,
  listCommandHistory,
  listSandboxProcesses,
  runSandboxCommand,
  sandboxCommandStatus,
  startSandboxProcess,
} from "./service.ts";
import { attachStream, commandStream, ndjson } from "./streams.ts";

export const commandsRouter = new Hono<ApiEnv>()
  .post("/sandboxes/:sandboxId/commands", validate("json", CommandRequest), async (c) => {
    const id = c.req.param("sandboxId");
    const request = c.req.valid("json");
    assertRunnable(id);

    if (request.detached) {
      const started = await startSandboxProcess(id, request, "detached");
      return c.json({
        ok: true as const,
        type: "command.started" as const,
        success: true,
        ...started,
      });
    }

    if (request.stream) {
      return new Response(ndjson(commandStream(id, request)), {
        headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
      });
    }

    return c.json(await runSandboxCommand(id, request));
  })
  .get("/sandboxes/:sandboxId/command-history", async (c) =>
    c.json({
      ok: true,
      type: "command.history",
      commands: await listCommandHistory(c.req.param("sandboxId")),
    }),
  )
  .get("/sandboxes/:sandboxId/command-history/:commandId", async (c) => {
    const command = await commandHistoryInfo(c.req.param("sandboxId"), c.req.param("commandId"));
    return c.json({ ok: true as const, success: true, type: "command.info" as const, command });
  })
  .get(
    "/sandboxes/:sandboxId/command-history/:commandId/logs",
    validate("query", CommandLogsQuery),
    async (c) => {
      const logs = await commandHistoryLogs(
        c.req.param("sandboxId"),
        c.req.param("commandId"),
        c.req.valid("query"),
      );
      return c.json({ ok: true as const, success: true, ...logs });
    },
  )
  .get("/sandboxes/:sandboxId/processes", async (c) => {
    const result = await listSandboxProcesses(c.req.param("sandboxId"));
    return c.json({ ok: true, type: "process.list", ...result });
  })
  .get(
    "/sandboxes/:sandboxId/commands/:processId",
    validate("query", CommandsStatusQuery),
    async (c) => {
      const query = c.req.valid("query");
      const status = await sandboxCommandStatus(
        c.req.param("sandboxId"),
        c.req.param("processId"),
        query,
      );
      return c.json({ ok: true as const, success: true, ...status });
    },
  )
  .delete("/sandboxes/:sandboxId/commands/:processId", async (c) => {
    const result = await killSandboxProcess(c.req.param("sandboxId"), c.req.param("processId"));
    return c.json({
      ok: true as const,
      success: true,
      type: "command.stopped" as const,
      ...result,
    });
  })
  .get(
    "/sandboxes/:sandboxId/commands/:processId/stream",
    validate("query", CommandsAttachQuery),
    async (c) => {
      await requireSandbox(c.req.param("sandboxId"));
      const frames = attachStream(
        c.req.param("sandboxId"),
        c.req.param("processId"),
        c.req.valid("query"),
      );
      return new Response(ndjson(frames), {
        headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
      });
    },
  );
