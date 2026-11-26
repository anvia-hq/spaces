import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { UsageQuery } from "./schema.ts";
import { sandboxUsage } from "./service.ts";

export const usageRouter = new Hono<ApiEnv>().get(
  "/sandboxes/:sandboxId/usage",
  validate("query", UsageQuery),
  async (c) => {
    const usage = await sandboxUsage(c.req.param("sandboxId"), c.req.valid("query"));
    return c.json({ ok: true as const, success: true, ...usage });
  },
);
