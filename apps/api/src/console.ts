import type { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { existsSync } from "node:fs";
import { config } from "./config.ts";
import type { ApiEnv } from "./errors.ts";

/** Paths the console must never answer: the API owns them. */
export const isApiPath = (path: string) =>
  path === "/health" || path === "/api" || path.startsWith("/api/");

/**
 * Serve the built console from the same origin as the API.
 *
 * Only active when `SPACES_WEB_ROOT` points at `apps/web/dist`; in development
 * Vite serves the console and proxies `/api` here.
 *
 * Registered last, and explicitly stepping aside for `/api` and `/health`: the
 * SPA fallback must never answer a mistyped endpoint with the console's HTML and
 * a 200, which is exactly how "the API is unreachable" gets misdiagnosed.
 */
export function mountConsole(app: Hono<ApiEnv>): void {
  if (!config.webRoot) return;

  const indexFile = `${config.webRoot.replace(/\/$/, "")}/index.html`;
  let indexHtml: string | null = null;

  app.use("/*", async (c, next) => {
    if (isApiPath(new URL(c.req.url).pathname)) return next();

    return serveStatic({ root: config.webRoot })(c, next);
  });

  app.get("*", async (c) => {
    if (isApiPath(new URL(c.req.url).pathname)) return c.notFound();

    if (!existsSync(indexFile)) return c.notFound();

    indexHtml ??= await Bun.file(indexFile).text();
    return c.html(indexHtml, 200, { "cache-control": "no-store" });
  });
}
