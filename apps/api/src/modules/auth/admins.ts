import { eq, inArray, or, user } from "@spaces/db";
import { db, one } from "../../db.ts";
import type { AuditEntry } from "../audit/types.ts";
import { adminRole, isAdminRole, type Principal, type Role } from "./types.ts";
import { config } from "../../config.ts";

type Adapter = {
  findUserById(userId: string): Promise<{ email: string; role?: string | null } | null>;
  updateUser(userId: string, data: Record<string, unknown>): Promise<unknown>;
};

type HookContext = { context?: { internalAdapter?: Adapter } } | null;

/** The one definition of "may act as the operator": the key, or an admin role. */
export function mayOperate(principal: Principal | undefined): boolean {
  if (!principal) return false;

  return principal.kind === "operator" || (principal.kind === "user" && principal.admin);
}

export function listedAdminEmail(email: string): boolean {
  return config.adminEmails.includes(email.trim().toLowerCase());
}

export async function adminCount(): Promise<number> {
  const rows = await db.select({ role: user.role }).from(user);
  return rows.filter((row) => isAdminRole(row.role)).length;
}

/** Test collateral: one process, one database, and admins from earlier files linger. */
export async function demoteAllAdmins(): Promise<number> {
  const demoted = await db
    .update(user)
    .set({ role: "user" })
    .where(or(eq(user.role, adminRole), eq(user.role, `${adminRole},user`)))
    .returning({ id: user.id });
  return demoted.length;
}

async function roleOf(userId: string): Promise<Role | null> {
  const row = await one(db.select({ role: user.role }).from(user).where(eq(user.id, userId)));
  return row ? ((row.role ?? "user") as Role) : null;
}

/** Promotion is its own action in the log; the owner still owns the row. */
export function promotionEntry(userId: string, email: string | null, reason: string): AuditEntry {
  return {
    action: "auth.admin_bootstrap",
    actorKind: "system",
    actorLabel: "SPACES_ADMIN_EMAILS",
    targetType: "user",
    targetId: userId,
    result: "ok",
    ownerId: userId,
    metadata: { email, role: adminRole, reason },
  };
}

/**
 * The bootstrap: an address in `SPACES_ADMIN_EMAILS` becomes an admin the first
 * time it signs in or signs up. Idempotent, audited once per promotion, and
 * harmless once the variable is emptied again (docs/decision/0037).
 */
export async function promoteIfListed(
  authContext: HookContext,
  userId: string,
): Promise<AuditEntry | null> {
  if (config.adminEmails.length === 0) return null;

  const adapter = authContext?.context?.internalAdapter;

  if (!adapter) return null;

  const found = await adapter.findUserById(userId);

  if (!found || !listedAdminEmail(found.email) || isAdminRole(found.role)) return null;

  await adapter.updateUser(userId, { role: adminRole });
  return promotionEntry(userId, found.email, "session");
}

/** Demoting the last admin would leave a deployment with nobody who can act. */
export async function refusesLastAdmin(userId: string, next: Role): Promise<boolean> {
  if (isAdminRole(next)) return false;

  const current = await roleOf(userId);

  if (!current || !isAdminRole(current)) return false;

  return (await adminCount()) <= 1;
}

/** The same list, applied at boot to accounts that already existed. */
export async function promoteListedAtBoot(): Promise<string[]> {
  if (config.adminEmails.length === 0) return [];

  const promoted = await db
    .update(user)
    .set({ role: adminRole })
    .where(inArray(user.email, [...config.adminEmails]))
    .returning({ id: user.id, email: user.email });

  return promoted.map((row) => row.id);
}
