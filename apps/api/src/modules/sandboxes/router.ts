import { Hono } from "hono";
import { CreateSandboxRequest, UpdateSandboxRequest } from "@spaces/shared/sandbox";
import type { SandboxState } from "@spaces/shared/sandbox";
import { type ApiEnv, fail, validate } from "../../errors.ts";
import {
  EventsQuery,
  ForkRequest,
  ResumeRequest,
  SandboxListQuery,
  StopRequest,
} from "./schema.ts";
import {
  createSandbox,
  destroySandbox,
  findIdempotentSandbox,
  forkSandbox,
  getSandbox,
  getSandboxNetwork,
  getStopOperation,
  listSandboxesPage,
  parseSandboxCursor,
  recoverSandbox,
  rememberIdempotentSandbox,
  resumeSandbox,
  sandboxEvents,
  stopSandbox,
  updateSandbox,
} from "./service.ts";

function labelList(label: string | string[] | undefined): string[] {
  if (Array.isArray(label)) return label;

  if (label) return [label];

  return [];
}

export const sandboxesRouter = new Hono<ApiEnv>()
  .get("/sandboxes", validate("query", SandboxListQuery), async (c) => {
    const q = c.req.valid("query");
    const cursor = q.cursor ? parseSandboxCursor(q.cursor) : undefined;

    if (q.cursor && !cursor) {
      return fail(c, "invalid_query", "cursor must be <iso-timestamp>|<sandboxId>");
    }

    const labels = labelList(q.label);
    const page = await listSandboxesPage({
      states: q.state ? (q.state.split(",").map((s) => s.trim()) as SandboxState[]) : undefined,
      name: q.name,
      namePrefix: q.namePrefix,
      stoppedBefore: q.stoppedBefore,
      sort: q.sort,
      limit: q.limit,
      cursor: cursor ?? undefined,
      labels,
    });
    return c.json({
      ok: true,
      type: "sandbox.list",
      sandboxes: page.sandboxes,
      nextCursor: page.nextCursor,
    });
  })
  .post("/sandboxes", validate("json", CreateSandboxRequest), async (c) => {
    const input = c.req.valid("json");
    const key = c.req.header("idempotency-key");

    if (key) {
      const existing = await findIdempotentSandbox(key);

      if (existing) {
        const status =
          input.wait && ["ready", "running", "idle"].includes(existing.state) ? 201 : 202;
        return c.json(
          { ok: true, type: "sandbox.created", status: existing.state, sandbox: existing },
          status,
        );
      }
    }

    const { sandbox, ready } = await createSandbox(input);

    if (key) await rememberIdempotentSandbox(key, sandbox.id);

    c.set("audit", {
      targetId: sandbox.id,
      targetType: "sandbox",
      metadata: { type: sandbox.type, name: sandbox.name },
    });

    return c.json(
      {
        ok: true,
        type: "sandbox.created",
        status: sandbox.state,
        ttlSeconds: input.ttlSeconds,
        sandbox,
      },
      ready ? 201 : 202,
    );
  })
  .get("/sandboxes/:sandboxId", async (c) =>
    c.json({ ok: true, type: "sandbox", sandbox: await getSandbox(c.req.param("sandboxId")) }),
  )
  .get("/sandboxes/:sandboxId/network", async (c) =>
    c.json({
      ok: true as const,
      type: "sandbox.network" as const,
      network: await getSandboxNetwork(c.req.param("sandboxId")),
    }),
  )
  .patch("/sandboxes/:sandboxId", validate("json", UpdateSandboxRequest), async (c) => {
    const sandbox = await updateSandbox(c.req.param("sandboxId"), c.req.valid("json"));
    return c.json({ ok: true, type: "sandbox", sandbox });
  })
  .delete("/sandboxes/:sandboxId", async (c) => {
    const id = c.req.param("sandboxId");
    await destroySandbox(id);
    return c.json({ ok: true, type: "sandbox.deleted", id });
  })
  .post("/sandboxes/:sandboxId/stop", validate("json", StopRequest), async (c) => {
    const id = c.req.param("sandboxId");
    const body = (c.req.valid("json") ?? {}) as { force?: boolean };
    const result = await stopSandbox(id, { force: body.force });
    return c.json({
      ok: true as const,
      type: "stop.status" as const,
      id: result.stopId,
      stop: result.stop,
      sandbox: result.sandbox,
      statusUrl: `/api/v1/sandboxes/${id}/stops/${result.stopId}`,
    });
  })
  .get("/sandboxes/:sandboxId/stops/:stopId", async (c) => {
    const stop = await getStopOperation(c.req.param("sandboxId"), c.req.param("stopId"));
    return c.json({
      ok: true as const,
      success: true,
      type: "stop.status" as const,
      id: stop.id,
      stop,
    });
  })
  .post("/sandboxes/:sandboxId/resume", validate("json", ResumeRequest), async (c) => {
    const body = c.req.valid("json");
    const sandbox = await resumeSandbox(c.req.param("sandboxId"), {
      ttlSeconds: body.ttlSeconds,
      type: body.type,
      name: body.name,
      env: body.env,
    });
    return c.json({ ok: true, type: "sandbox.resumed", status: sandbox.state, sandbox }, 202);
  })
  .post("/sandboxes/:sandboxId/fork", validate("json", ForkRequest), async (c) => {
    const sandbox = await forkSandbox(c.req.param("sandboxId"), c.req.valid("json"));
    return c.json({ ok: true, type: "sandbox.forked", status: sandbox.state, sandbox }, 202);
  })
  .get("/sandboxes/:sandboxId/events", validate("query", EventsQuery), async (c) => {
    const { after } = c.req.valid("query");
    return c.json({
      ok: true,
      type: "sandbox.events",
      events: await sandboxEvents(c.req.param("sandboxId"), after ?? 0),
    });
  })
  .post("/sandboxes/:sandboxId/recover", async (c) => {
    const result = await recoverSandbox(c.req.param("sandboxId"));
    return c.json({ ok: true as const, ...result });
  });
