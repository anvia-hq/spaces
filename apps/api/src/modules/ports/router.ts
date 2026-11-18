import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { publicOrigin } from "../../origin.ts";
import { proxyPreview } from "./preview.ts";
import { HostPortRequest } from "./schema.ts";
import { hostSandboxPort, listHostedPorts, unhostSandboxPort } from "./service.ts";

export const portsRouter = new Hono<ApiEnv>()
  .post("/sandboxes/:sandboxId/host", validate("json", HostPortRequest), async (c) => {
    const hosted = await hostSandboxPort(
      c.req.param("sandboxId"),
      c.req.valid("json"),
      publicOrigin(c.req.url),
    );
    const body: {
      ok: true;
      success: true;
      type: "port.hosted";
      port: number;
      url: string;
      isProtected: boolean;
      access: "private" | "public";
      restartRequired?: true;
      message?: string;
    } = {
      ok: true,
      success: true,
      type: "port.hosted",
      port: hosted.port,
      url: hosted.url,
      isProtected: hosted.isProtected,
      access: hosted.access,
    };

    if (hosted.restartRequired) {
      body.restartRequired = true;
      body.message =
        `Port ${hosted.port} was not pre-published, so the microVM was restarted to ` +
        "add the mapping. Anything running inside the sandbox stopped; the disk is " +
        "intact. Pre-publish it with SPACES_PREPUBLISH_PORTS to avoid this.";
    }

    return c.json(body);
  })
  .get("/sandboxes/:sandboxId/ports", async (c) =>
    c.json({
      ok: true as const,
      type: "port.list" as const,
      ports: await listHostedPorts(c.req.param("sandboxId")),
    }),
  )
  .delete("/sandboxes/:sandboxId/host/:port", async (c) => {
    const result = await unhostSandboxPort(c.req.param("sandboxId"), Number(c.req.param("port")));
    return c.json({ ok: true as const, success: true, type: "port.unhosted" as const, ...result });
  })
  .all("/_preview/:sandboxId/:port", proxyPreview)
  .all("/_preview/:sandboxId/:port/*", proxyPreview);
