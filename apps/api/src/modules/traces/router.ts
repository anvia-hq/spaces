import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { MetricsQuery, TraceListQuery } from "./schema.ts";
import { listTraces, metrics, traceSpans } from "./service.ts";

export const tracesRouter = new Hono<ApiEnv>()
  .get("/traces", validate("query", TraceListQuery), async (c) => {
    const traces = await listTraces(c.req.valid("query"));
    return c.json({ ok: true as const, type: "trace.list" as const, traces });
  })
  .get("/traces/metrics", validate("query", MetricsQuery), async (c) => {
    const summary = await metrics(c.req.valid("query").windowMinutes ?? 60);
    return c.json({ ok: true as const, type: "trace.metrics" as const, ...summary });
  })
  .get("/traces/:traceId", async (c) => {
    const spans = await traceSpans(c.req.param("traceId"));
    return c.json({
      ok: true as const,
      type: "trace" as const,
      traceId: c.req.param("traceId"),
      spans,
    });
  });
