import { Hono } from "hono";
import type { Context } from "hono";
import { CreateRuntimeRequest, UpdateRuntimeRequest } from "@spaces/shared/runtime";
import { type ApiEnv, fail, validate } from "../../errors.ts";
import { mayOperate } from "../auth/admins.ts";
import { RuntimeParams } from "./schema.ts";
import {
  createRuntime,
  deleteRuntime,
  getRuntime,
  listRuntimes,
  rotateRuntimeToken,
  shapeRuntime,
  updateRuntime,
} from "./service.ts";

const OPERATOR_ONLY =
  "Runtimes are operator-owned: sign in as an admin, or send the operator key (SPACES_API_KEY).";

function operatorOnly(c: Context<ApiEnv>) {
  if (mayOperate(c.get("principal"))) return null;

  return fail(c, "forbidden", OPERATOR_ONLY);
}

export const runtimesRouter = new Hono<ApiEnv>()
  .get("/runtimes", async (c) =>
    c.json({
      ok: true as const,
      type: "runtime.list" as const,
      runtimes: await listRuntimes(),
    }),
  )
  .get("/runtimes/:runtime", validate("param", RuntimeParams), async (c) =>
    c.json({
      ok: true as const,
      type: "runtime.get" as const,
      runtime: await getRuntime(c.req.valid("param").runtime),
    }),
  )
  .post("/runtimes", validate("json", CreateRuntimeRequest), async (c) => {
    const denied = operatorOnly(c);

    if (denied) return denied;

    const { runtime, token } = await createRuntime(c.req.valid("json"));
    c.set("audit", { targetId: runtime.id, targetType: "runtime" });

    return c.json(
      {
        ok: true as const,
        type: "runtime.created" as const,
        runtime: shapeRuntime(runtime),
        token,
      },
      201,
    );
  })
  .patch(
    "/runtimes/:runtime",
    validate("param", RuntimeParams),
    validate("json", UpdateRuntimeRequest),
    async (c) => {
      const denied = operatorOnly(c);

      if (denied) return denied;

      const runtime = await updateRuntime(c.req.valid("param").runtime, c.req.valid("json"));
      c.set("audit", { targetId: runtime.id, targetType: "runtime" });

      return c.json({ ok: true as const, type: "runtime.updated" as const, runtime });
    },
  )
  .post("/runtimes/:runtime/token", validate("param", RuntimeParams), async (c) => {
    const denied = operatorOnly(c);

    if (denied) return denied;

    const { runtime, token } = await rotateRuntimeToken(c.req.valid("param").runtime);
    c.set("audit", { targetId: runtime.id, targetType: "runtime" });

    return c.json({
      ok: true as const,
      type: "runtime.token_rotated" as const,
      runtime: shapeRuntime(runtime),
      token,
    });
  })
  .delete("/runtimes/:runtime", validate("param", RuntimeParams), async (c) => {
    const denied = operatorOnly(c);

    if (denied) return denied;

    const removed = await deleteRuntime(c.req.valid("param").runtime);
    c.set("audit", { targetId: removed.id, targetType: "runtime" });

    return c.json({ ok: true as const, type: "runtime.deleted" as const, ...removed });
  });
