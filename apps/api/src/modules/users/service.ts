import type { Context } from "hono";
import { type ApiEnv, fail, ServiceError } from "../../errors.ts";
import { auth } from "../auth/service.ts";
import { mayOperate, refusesLastAdmin } from "../auth/admins.ts";
import { type AdminRole, isAdminRole, type ManagedUser, type UserPage } from "../auth/types.ts";

const NOT_ADMIN =
  "Only an admin can manage accounts; the operator key or a role of `admin` is needed.";

export function requireAdmin(c: Context<ApiEnv>) {
  if (mayOperate(c.get("principal"))) return null;

  return fail(c, "forbidden", NOT_ADMIN);
}

function shape(row: {
  id: string;
  email: string;
  name: string;
  role?: string | null;
  banned?: boolean | null;
  createdAt: Date;
}): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role ?? "user",
    admin: isAdminRole(row.role),
    banned: row.banned === true,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}

export async function listUsers(input: {
  search?: string;
  limit: number;
  offset: number;
}): Promise<UserPage> {
  const context = await auth.$context;
  const search = input.search?.trim();
  const where = search
    ? [{ field: "email", operator: "contains" as const, value: search }]
    : undefined;

  const rows = await context.internalAdapter.listUsers(
    input.limit,
    input.offset,
    { field: "createdAt", direction: "desc" },
    where,
  );

  return {
    users: rows.map(shape),
    total: await context.internalAdapter.countTotalUsers(where),
    limit: input.limit,
    offset: input.offset,
  };
}

/**
 * `admin` or `user`, nothing else: a role the plugin cannot authorise is a role
 * nobody can reason about. The last admin cannot be demoted, because then no
 * account could promote anybody back (docs/decision/0037).
 */
export async function setRole(userId: string, role: AdminRole) {
  if (await refusesLastAdmin(userId, role)) {
    throw new ServiceError("forbidden", "This is the last admin; promote somebody else first.");
  }

  const updated = await (await auth.$context).internalAdapter.updateUser(userId, { role });

  if (!updated) throw new ServiceError("not_found", "No such user.");

  return shape(updated);
}

export async function ban(userId: string, reason: string | null) {
  if (await refusesLastAdmin(userId, "user")) {
    throw new ServiceError("forbidden", "This is the last admin; promote somebody else first.");
  }

  const updated = await (
    await auth.$context
  ).internalAdapter.updateUser(userId, {
    banned: true,
    banReason: reason,
  });

  if (!updated) throw new ServiceError("not_found", "No such user.");

  return shape(updated);
}

export async function unban(userId: string) {
  const updated = await (
    await auth.$context
  ).internalAdapter.updateUser(userId, {
    banned: false,
    banReason: null,
    banExpires: null,
  });

  if (!updated) throw new ServiceError("not_found", "No such user.");

  return shape(updated);
}
