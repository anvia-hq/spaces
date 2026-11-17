import { Hono } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { loginConfig } from "./login-config.ts";

export const meRouter = new Hono<ApiEnv>().get("/me", (c) => {
  const principal = c.get("principal");
  return c.json({
    ok: true as const,
    type: "me" as const,
    principal,
    operator: principal.kind === "operator",
    login: loginConfig(),
  });
});
