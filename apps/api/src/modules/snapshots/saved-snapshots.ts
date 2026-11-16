import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import {
  createSnapshotShare,
  deleteSavedSnapshot,
  listSavedSnapshots,
  listSnapshotShares,
  requireSavedSnapshot,
  revokeSnapshotShare,
  saveNamedSnapshot,
  savedSnapshot,
  savedSnapshotAllowance,
} from "./saved-service.ts";
import { SavedSnapshotListQuery, SavedSnapshotSaveRequest } from "./schema.ts";

export const savedSnapshotsRouter = new Hono<ApiEnv>()
  .get("/saved-snapshots", validate("query", SavedSnapshotListQuery), async (c) =>
    c.json({
      ok: true as const,
      success: true,
      type: "snapshot.saved.list" as const,
      snapshots: await listSavedSnapshots(c.req.valid("query")),
      allowance: await savedSnapshotAllowance(),
    }),
  )
  .post("/saved-snapshots", validate("json", SavedSnapshotSaveRequest), async (c) => {
    const { sandboxId, name } = c.req.valid("json");
    const snapshot = await saveNamedSnapshot(sandboxId, name);

    c.set("audit", {
      targetId: name,
      targetType: "snapshot",
      metadata: { sandboxId, status: snapshot.status },
    });

    return c.json(
      { ok: true as const, success: true, type: "snapshot.saved.info" as const, snapshot },
      202,
    );
  })
  .get("/saved-snapshots/:name", async (c) =>
    c.json({
      ok: true as const,
      success: true,
      type: "snapshot.saved.info" as const,
      snapshot: savedSnapshot(await requireSavedSnapshot(c.req.param("name"))),
    }),
  )
  .delete("/saved-snapshots/:name", async (c) => {
    const result = await deleteSavedSnapshot(c.req.param("name"));
    return c.json({
      ok: true as const,
      success: true,
      type: "snapshot.saved.deleted" as const,
      ...result,
    });
  })
  /**
   * `boat snapshot <id> <name>` is the deprecated spelling of saved snapshots.
   * Same handlers, same storage; only the `type` differs.
   */
  .get("/named-snapshots", async (c) =>
    c.json({
      ok: true as const,
      success: true,
      type: "snapshot.named.list" as const,
      snapshots: await listSavedSnapshots(),
    }),
  )
  .post("/named-snapshots", validate("json", SavedSnapshotSaveRequest), async (c) => {
    const { sandboxId, name } = c.req.valid("json");
    const snapshot = await saveNamedSnapshot(sandboxId, name);
    return c.json(
      { ok: true as const, success: true, type: "snapshot.named.info" as const, snapshot },
      202,
    );
  })
  .get("/named-snapshots/:name", async (c) =>
    c.json({
      ok: true as const,
      success: true,
      type: "snapshot.named.info" as const,
      snapshot: savedSnapshot(await requireSavedSnapshot(c.req.param("name"))),
    }),
  )
  .delete("/named-snapshots/:name", async (c) => {
    const result = await deleteSavedSnapshot(c.req.param("name"));
    return c.json({
      ok: true as const,
      success: true,
      type: "snapshot.named.deleted" as const,
      ...result,
    });
  })
  .get("/saved-snapshots/:name/shares", async (c) => {
    const name = c.req.param("name");
    return c.json({
      ok: true as const,
      success: true,
      type: "snapshot.share.list" as const,
      name,
      shares: await listSnapshotShares(name),
    });
  })
  .post("/saved-snapshots/:name/shares", async (c) => {
    const created = await createSnapshotShare(c.req.param("name"));
    return c.json(
      {
        ok: true as const,
        success: true,
        type: "snapshot.share.created" as const,
        name: created.name,
        shareCode: created.shareCode,
        share: created.share,
      },
      201,
    );
  })
  .delete("/saved-snapshots/:name/shares/:shareId", async (c) => {
    const name = c.req.param("name");
    return c.json({
      ok: true as const,
      success: true,
      type: "snapshot.share.revoked" as const,
      name,
      share: await revokeSnapshotShare(name, c.req.param("shareId")),
    });
  });
