import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import {
  deleteSavedSnapshot,
  listSavedSnapshots,
  requireSavedSnapshot,
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
  });
