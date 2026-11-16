import { Hono } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { auth } from "./service.ts";

/**
 * Better Auth's own surface: `/api/auth/sign-up`, `/sign-in`, `/sign-out`,
 * `/get-session`. It answers with its own cookies and envelopes, so it is
 * mounted outside the `/api/v1` contract rather than translated into it.
 */
export const authRouter = new Hono<ApiEnv>().on(["GET", "POST"], "/auth/*", (c) =>
  auth.handler(c.req.raw),
);
