import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { publicOrigin } from "../../origin.ts";
import { SnapshotFileQuery } from "./schema.ts";
import {
  deleteSandboxSnapshots,
  deleteSnapshot,
  latestSnapshot,
  listSnapshots,
  mintSnapshotDownload,
  snapshotFileEntry,
  snapshotTree,
} from "./service.ts";

export const snapshotsRouter = new Hono<ApiEnv>()
  .get("/snapshots", async (c) =>
    c.json({ ok: true, type: "snapshot.list", snapshots: await listSnapshots() }),
  )
  .get("/sandboxes/:sandboxId/snapshots", async (c) =>
    c.json({
      ok: true,
      type: "snapshot.list",
      snapshots: await listSnapshots(c.req.param("sandboxId")),
    }),
  )
  .get("/sandboxes/:sandboxId/snapshots/latest", async (c) =>
    c.json({
      ok: true,
      type: "snapshot",
      snapshot: await latestSnapshot(c.req.param("sandboxId")),
    }),
  )
  .get("/snapshots/:snapshotId/tree", async (c) => {
    const tree = await snapshotTree(c.req.param("snapshotId"));
    return c.json({ ok: true as const, success: true, ...tree });
  })
  .get("/snapshots/:snapshotId/files", validate("query", SnapshotFileQuery), async (c) => {
    const entry = await snapshotFileEntry(
      c.req.param("snapshotId"),
      c.req.valid("query").path ?? "",
    );

    let body = entry.bytes;
    let status = 200;
    const headers: Record<string, string> = {
      "content-type": entry.kind === "dir" ? "application/x-tar" : "application/octet-stream",
      "accept-ranges": "bytes",
      "x-snapshot-entry-kind": entry.kind,
    };

    const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "");

    if (entry.kind === "file" && range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), body.byteLength - 1) : body.byteLength - 1;

      if (start <= end && start < body.byteLength) {
        headers["content-range"] = `bytes ${start}-${end}/${body.byteLength}`;
        body = body.subarray(start, end + 1);
        status = 206;
      }
    }

    headers["content-length"] = String(body.byteLength);

    if (entry.kind === "dir") {
      headers["x-snapshot-file-count"] = "0";
      headers["x-snapshot-total-size-bytes"] = String(body.byteLength);
      headers["x-snapshot-skipped-base-image-files"] = "0";
    }

    return new Response(body, { status, headers });
  })
  .delete("/snapshots/:snapshotId", async (c) => {
    const result = await deleteSnapshot(c.req.param("snapshotId"));
    return c.json({ ok: true as const, type: "snapshot.deleted" as const, ...result });
  })
  .delete("/sandboxes/:sandboxId/snapshots", async (c) => {
    const result = await deleteSandboxSnapshots(c.req.param("sandboxId"));
    return c.json({ ok: true as const, type: "snapshot.deleted" as const, ...result });
  })
  .get("/snapshots/:snapshotId/download", async (c) => {
    const download = await mintSnapshotDownload(c.req.param("snapshotId"), publicOrigin(c.req.url));

    return c.json({
      ok: true as const,
      success: true,
      type: "snapshot.download" as const,
      snapshotId: download.snapshotId,
      sandboxId: download.sandboxId,
      kind: "base" as const,
      generation: 1,
      expiresInSeconds: download.expiresInSeconds,
      reconstruct:
        "One chunk holding a tar of the sandbox work directory. Download it and extract " +
        "with `tar -xf` to reproduce the files in this snapshot.",
      inventory: null,
      chunks: [
        {
          snapshotId: download.snapshotId,
          generation: 1,
          chunkIndex: 0,
          r2Key: `snapshots/${download.snapshotId}/workdir.tar`,
          sizeBytes: download.totalSizeBytes,
          sha256: null,
          signedUrl: download.signedUrl,
        },
      ],
    });
  })
  .get("/_snapshot-download/:snapshotId", async (c) => {
    const entry = await snapshotFileEntry(c.req.param("snapshotId"), "");
    return new Response(entry.bytes, {
      headers: {
        "content-type": "application/x-tar",
        "content-length": String(entry.bytes.byteLength),
        "x-snapshot-entry-kind": "dir",
      },
    });
  });
