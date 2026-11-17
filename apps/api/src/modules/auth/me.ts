import { Hono } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { mayOperate } from "./admins.ts";
import { loginConfig } from "./login-config.ts";
import { adminRole, type MeAnswer } from "./types.ts";

/**
 * Who the console is talking to. `admin` is the one field it needs to decide
 * whether to show an operator surface; `role`, `operator` and `login` say why
 * and what else the deployment offers.
 */
export const meRouter = new Hono<ApiEnv>().get("/me", (c) => {
  const principal = c.get("principal");
  const admin = mayOperate(principal);

  const answer: MeAnswer = {
    ok: true,
    type: "me",
    principal,
    operator: principal.kind === "operator",
    role: principal.kind === "user" ? principal.role : adminRole,
    admin,
    login: loginConfig(),
  };

  return c.json(answer);
});
