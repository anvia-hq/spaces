import type { MiddlewareHandler } from "hono";
import type { ApiEnv } from "./errors.ts";

/**
 * Boat accepts `Content-Type: application/json` with an empty body and treats it
 * as `{}` — `POST /stop` and `POST /resume` are routinely sent that way. Hono's
 * JSON parser answers "Malformed JSON in request body" instead, which is a
 * conformance break for every optional-body route.
 *
 * The body is rewritten before validation rather than reimplementing the
 * validator, so route typing and the existing error mapping are untouched.
 * Only JSON requests are considered: an empty `application/octet-stream` upload
 * is a legitimate empty file and must stay empty.
 */
export const emptyJsonBody: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.req.method === "GET" || c.req.method === "HEAD") return next();

  if (!(c.req.header("content-type") ?? "").toLowerCase().includes("application/json")) {
    return next();
  }

  const declared = c.req.header("content-length");
  let empty = declared === "0";

  if (!empty && declared === undefined) {
    // No length (chunked): peek at a clone so the original stays parsable.
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
