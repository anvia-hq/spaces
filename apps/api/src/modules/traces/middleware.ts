import type { MiddlewareHandler } from "hono";
import { SpanKind, context, trace } from "@opentelemetry/api";
import type { ApiEnv } from "../../errors.ts";

export const traceRequests: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const started = performance.now();

  const span = trace.getTracer("spaces").startSpan("http.request", {
    kind: SpanKind.SERVER,
    attributes: {
      "http.method": c.req.method,
      "http.target": c.req.path,
      "spaces.request_id": c.get("requestId") ?? "",
    },
  });

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      await next();

      const principal = c.get("principal");
      span.setAttribute("http.route", c.req.routePath || c.req.path);
      span.setAttribute("http.status_code", c.res.status);
      span.setAttribute("spaces.actor_kind", principal?.kind ?? "anonymous");

      if (principal?.kind === "user") span.setAttribute("spaces.owner_id", principal.userId);

      if (c.res.status >= 500) {
        span.setStatus({ code: 2, message: `HTTP ${c.res.status}` });
      } else if (c.res.status >= 400) {
        span.setStatus({ code: 2, message: `HTTP ${c.res.status}` });
      } else {
        span.setStatus({ code: 1 });
      }
    } catch (error) {
      span.setStatus({
        code: 2,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.setAttribute("http.duration_ms", Math.round(performance.now() - started));
      span.end();
    }
  });
};
