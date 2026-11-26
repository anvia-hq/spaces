import { Hono } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { auth } from "./service.ts";

export const authRouter = new Hono<ApiEnv>().on(["GET", "POST"], "/auth/*", (c) =>
  auth.handler(c.req.raw),
);
