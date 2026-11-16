import type { Handler } from "hono";
import { config } from "../../config.ts";
import type { ApiEnv } from "../../errors.ts";
import { verifyTransferToken } from "../files/sign.ts";
import { previewPath, resolvePreview } from "./service.ts";
import { tunnelFor } from "./tunnel.ts";

/**
 * Reverse proxy for a published port.
 *
 * The guest has no public address, so the API forwards the request to the host
 * port msb published. A preview URL is usable straight from a browser, so it
 * authenticates with its own `_token` rather than the bearer header.
 */
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

  // Everything after /<port> is the guest's own path.
  const url = new URL(c.req.url);
  const marker = `/api/v1/_preview/${sandboxId}/${guestPort}`;
  const suffix = url.pathname.slice(marker.length) || "/";
  const forwardedQuery = new URLSearchParams(url.searchParams);
  forwardedQuery.delete("_token");
  const query = forwardedQuery.toString();
  // When msb lives on another machine the published port is on that machine's
  // loopback, so the request goes through a local SSH forward.
  let dialPort: number;
  try {
    dialPort = await tunnelFor(config.msbHost, row.hostPort);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(
      {
        ok: false as const,
        type: "sandbox.error" as const,
        status: 502,
        code: "boat_direct_failed" as const,
        message: `Could not reach the published port on ${config.msbHost} (${message}).`,
      },
      502,
    );
  }
  const target = `http://127.0.0.1:${dialPort}${suffix}${query ? `?${query}` : ""}`;

  const headers = new Headers(c.req.raw.headers);
  // The upstream host is the loopback port; auth belongs to the API, and asking
  // for compression would leave a body whose headers no longer match.
  headers.delete("host");
  headers.delete("authorization");
  headers.delete("accept-encoding");
  headers.delete("connection");

  const method = c.req.method;
  const hasBody = !["GET", "HEAD"].includes(method);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await c.req.arrayBuffer() : undefined,
      redirect: "manual",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json(
      {
        ok: false as const,
        type: "sandbox.error" as const,
        status: 502,
        code: "boat_direct_failed" as const,
        message: `Nothing answered on port ${guestPort} inside the sandbox (${message}).`,
      },
      502,
    );
  }

  const responseHeaders = new Headers(upstream.headers);
  // Length and encoding describe the upstream body, not necessarily this one.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
