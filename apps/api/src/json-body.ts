import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "./errors.ts";

export const emptyJsonBody: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();

  if (!(c.req.header("content-type") ?? "").toLowerCase().includes("application/json")) {
    return next();
  }

  const declared = c.req.header("content-length");
  let empty = declared === "0";

  if (!empty && declared === undefined) {
    try {
      empty = (await c.req.raw.clone().text()).trim() === "";
    } catch {
      empty = false;
    }
  }

  if (!empty) return next();

  const headers = new Headers(c.req.raw.headers);
  headers.set("content-type", "application/json");
  Object.assign(c.req, {
    raw: new Request(c.req.url, { method: c.req.method, headers, body: "{}" }),
  });
  await next();
};
