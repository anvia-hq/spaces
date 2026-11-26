import type { Handler } from "hono";
import type { ApiEnv } from "../../errors.ts";
import { verifyTransferToken } from "../files/sign.ts";
import { driverOfSandbox } from "../runtimes/service.ts";
import { previewPath, resolvePreview } from "./service.ts";

export const proxyPreview: Handler<ApiEnv> = async (c) => {
  const sandboxId = c.req.param("sandboxId")!;
  const guestPort = Number(c.req.param("port"));

  const row = await resolvePreview(sandboxId, guestPort);

  if (!row.public) {
    const token = c.req.query("_token");

    if (!token) {
      return c.json(
        {
          ok: false as const,
          type: "sandbox.error" as const,
          status: 401,
          code: "unauthorized" as const,
          message: "This preview URL needs its _token query parameter.",
        },
        401,
      );
    }

    const check = await verifyTransferToken(token, "GET");

    if (!check.ok || check.claims.s !== sandboxId || check.claims.p !== previewPath(guestPort)) {
      return c.json(
        {
          ok: false as const,
          type: "sandbox.error" as const,
          status: 401,
          code: "unauthorized" as const,
          message: "Preview token is invalid, expired, or for another port.",
        },
        401,
      );
    }
  }

  const url = new URL(c.req.url);
  const marker = `/api/v1/_preview/${sandboxId}/${guestPort}`;
  const suffix = url.pathname.slice(marker.length) || "/";
  const forwardedQuery = new URLSearchParams(url.searchParams);
  forwardedQuery.delete("_token");
  const query = forwardedQuery.toString();
  const driver = await driverOfSandbox(sandboxId);
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("authorization");
  headers.delete("accept-encoding");
  headers.delete("connection");

  const method = c.req.method;
  const hasBody = !["GET", "HEAD"].includes(method);
  const upstream = await driver.proxyHttp({
    hostPort: row.hostPort,
    method,
    path: `${suffix}${query ? `?${query}` : ""}`,
    headers: [...headers.entries()],
    body: hasBody ? new Uint8Array(await c.req.arrayBuffer()) : null,
  });

  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
