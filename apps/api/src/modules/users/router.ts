import { Hono } from "hono";
import { type ApiEnv, validate } from "../../errors.ts";
import { BanRequest, SetRoleRequest, UserIdParams, UserListQuery } from "./schema.ts";
import { ban, listUsers, requireAdmin, setRole, unban } from "./service.ts";

/**
 * Who may act as an operator, and nothing else about an account. Every route
 * needs the admin predicate: the operator key still answers here as it always
 * did, and an account with the `admin` role is the second way in (0036).
 */
export const usersRouter = new Hono<ApiEnv>()
  .get("/users", validate("query", UserListQuery), async (c) => {
    const denied = requireAdmin(c);

    if (denied) return denied;

    const query = c.req.valid("query");
    const page = await listUsers({
      search: query.search,
      limit: query.limit ?? 50,
      offset: query.offset ?? 0,
    });

    return c.json({ ok: true as const, type: "user.list" as const, ...page });
  })
  .post(
    "/users/:userId/role",
    validate("param", UserIdParams),
    validate("json", SetRoleRequest),
    async (c) => {
      const denied = requireAdmin(c);

      if (denied) return denied;

      const { userId } = c.req.valid("param");
      const user = await setRole(userId, c.req.valid("json").role);
      c.set("audit", { targetId: userId, targetType: "user", metadata: { role: user.role } });
      c.set("audit", { action: "user.role_set" });
      return c.json({ ok: true as const, type: "user.role_set" as const, user });
    },
  )
  .post(
    "/users/:userId/ban",
    validate("param", UserIdParams),
    validate("json", BanRequest),
    async (c) => {
      const denied = requireAdmin(c);

      if (denied) return denied;

      const { userId } = c.req.valid("param");
      const user = await ban(userId, c.req.valid("json").reason ?? null);
      c.set("audit", { targetId: userId, targetType: "user" });
      return c.json({ ok: true as const, type: "user.banned" as const, user });
    },
  )
  .delete("/users/:userId/ban", validate("param", UserIdParams), async (c) => {
    const denied = requireAdmin(c);

    if (denied) return denied;

    const { userId } = c.req.valid("param");
    const user = await unban(userId);
    c.set("audit", { targetId: userId, targetType: "user" });
    return c.json({ ok: true as const, type: "user.unbanned" as const, user });
  });
