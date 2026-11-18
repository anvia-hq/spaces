import { Hono } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { health, limits } from "./service.ts";

export const systemRouter = new Hono<ApiEnv>()
  .get("/health", async (c) => c.json(await health()))
  .get("/api/v1/limits", async (c) => c.json(await limits()));
