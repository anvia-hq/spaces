import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { AuditQuery } from "./schema.ts";
import { auditSummary, listAudit } from "./service.ts";

export const auditRouter = new Hono<ApiEnv>()
  .get("/audit-log", validate("query", AuditQuery), async (c) => {
    const page = await listAudit(c.req.valid("query"));
    return c.json({ ok: true as const, type: "audit.list" as const, ...page });
  })
  .get("/audit-log/actions", async (c) => {
    const actions = await auditSummary();
    return c.json({ ok: true as const, type: "audit.actions" as const, actions });
  });
