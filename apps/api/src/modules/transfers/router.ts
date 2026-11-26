import { Hono } from "hono";
import type { Context } from "hono";
import { type ApiEnv, fail } from "../../errors.ts";
import { downloadTransfer, uploadTransfer } from "./service.ts";

function transferError(c: Context<ApiEnv>, reason: string) {
  if (reason === "expired") return fail(c, "not_found", "transfer URL has expired");

  return fail(c, "unauthorized", `invalid transfer URL (${reason})`);
}

export const transfersRouter = new Hono<ApiEnv>()
  .get("/_transfer/:token", async (c) => {
    const transfer = await downloadTransfer(c.req.param("token"));

    if (!transfer.ok) return transferError(c, transfer.reason);

    if (transfer.kind === "snapshot") {
      return new Response(transfer.bytes, {
        headers: {
          "content-type": "application/x-tar",
          "content-length": String(transfer.bytes.byteLength),
          "content-disposition": `attachment; filename="${transfer.snapshotId}.tar"`,
        },
      });
    }

    return new Response(transfer.bytes, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(transfer.bytes.byteLength),
        "content-disposition": `attachment; filename="${transfer.name.replace(/"/g, "")}"`,
      },
    });
  })
  .put("/_transfer/:token", async (c) => {
    const transfer = await uploadTransfer(c.req.param("token"), {
      declaredLength: Number(c.req.header("content-length") ?? 0),
      readBody: async () => new Uint8Array(await c.req.arrayBuffer()),
    });

    if (!transfer.ok) return transferError(c, transfer.reason);

    return c.json({
      ok: true,
      type: "file.written",
      success: true,
      path: transfer.path,
      size: transfer.size,
    });
  });
