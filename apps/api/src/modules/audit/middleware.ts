import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { routeAction } from "./actions.ts";
import { record } from "./service.ts";
import type { AuditHint } from "./types.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * One row for every authenticated mutation under /api/v1, however it ends.
 *
 * The route template names the action and the target, so a route added later is
 * audited without anyone remembering to; a handler that knows a created id can
 * say so with `c.set("audit", { targetId })`.
 */
export const auditMutations: MiddlewareHandler<ApiEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();

  if (!MUTATING.has(method)) return next();

  const started = Date.now();
  await next();

  const principal = c.get("principal");
  const hint = c.get("audit") as AuditHint | undefined;
  const template = c.req.routePath.replace(/^\/api\/v1/, "") || c.req.path;
  const route = routeAction(method, template);
  const status = c.res.status;
  const body = await failureCode(c.res);

  await record({
    action: hint?.action ?? route.action,
    actorKind: principal?.kind === "operator" ? "operator" : "user",
    actorId: principal?.kind === "user" ? principal.userId : null,
    actorLabel: principal?.kind === "user" ? principal.email : "operator",
    targetType: hint?.targetType ?? route.targetType ?? null,
    targetId:
      hint?.targetId ?? (route.targetParam ? (c.req.param(route.targetParam) ?? null) : null),
    result: status < 400 ? "ok" : "error",
    status,
    errorCode: body,
    requestId: c.get("requestId") ?? null,
    ip: clientIp(c.req.header("x-forwarded-for"), c.req.header("x-real-ip")),
    userAgent: c.req.header("user-agent") ?? null,
    durationMs: Date.now() - started,
    metadata: hint?.metadata ?? {},
    ownerId: principal?.kind === "user" ? principal.userId : null,
  });
};

/** The `code` of our error envelope, when the response is one. */
async function failureCode(response: Response): Promise<string | null> {
  const type = response.headers.get("content-type") ?? "";

  if (response.status < 400 || !type.includes("application/json")) return null;

  try {
    const body = (await response.clone().json()) as { code?: string };
    return body.code ?? null;
  } catch {
    return null;
  }
}

function clientIp(forwarded: string | undefined, real: string | undefined): string | null {
  const first = forwarded?.split(",")[0]?.trim();
  return first || real || null;
}
