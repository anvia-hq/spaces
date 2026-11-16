import { Hono } from "hono";
import type { Context } from "hono";
import { type ApiEnv, fail, validate } from "../../errors.ts";
import {
  CreateMachineSizeRequest,
  MachineSizeListQuery,
  MachineSizeNameParams,
  UpdateMachineSizeRequest,
} from "./schema.ts";
import {
  createMachineSize,
  listMachineSizes,
  retireMachineSize,
  updateMachineSize,
} from "./service.ts";

const OPERATOR_ONLY =
  "Machine sizes are operator-owned: send the operator key (SPACES_API_KEY) to change them.";

function operatorOnly(c: Context<ApiEnv>) {
  if (c.get("principal").kind === "operator") return null;

  return fail(c, "forbidden", OPERATOR_ONLY);
}

export const machineSizesRouter = new Hono<ApiEnv>()
  .get("/machine-sizes", validate("query", MachineSizeListQuery), async (c) =>
    c.json({
      ok: true as const,
      type: "machine_size.list" as const,
      sizes: await listMachineSizes(c.req.valid("query").includeRetired === "true"),
    }),
  )
  .post("/machine-sizes", validate("json", CreateMachineSizeRequest), async (c) => {
    const denied = operatorOnly(c);

    if (denied) return denied;

    const input = c.req.valid("json");
    const size = await createMachineSize(input);
    c.set("audit", {
      targetId: size.name,
      targetType: "machine_size",
      metadata: { vcpu: size.vcpu, memMib: size.memMib, diskGb: size.diskGb },
    });
    return c.json({ ok: true as const, type: "machine_size.created" as const, size }, 201);
  })
  .patch(
    "/machine-sizes/:name",
    validate("param", MachineSizeNameParams),
    validate("json", UpdateMachineSizeRequest),
    async (c) => {
      const denied = operatorOnly(c);

      if (denied) return denied;

      const size = await updateMachineSize(c.req.param("name"), c.req.valid("json"));
      c.set("audit", { targetId: size.name, targetType: "machine_size" });
      return c.json({ ok: true as const, type: "machine_size.updated" as const, size });
    },
  )
  .delete("/machine-sizes/:name", validate("param", MachineSizeNameParams), async (c) => {
    const denied = operatorOnly(c);

    if (denied) return denied;

    const retired = await retireMachineSize(c.req.param("name"));
    c.set("audit", {
      targetId: retired.name,
      targetType: "machine_size",
      metadata: { inUse: retired.inUse },
    });
    return c.json({ ok: true as const, type: "machine_size.retired" as const, ...retired });
  });
