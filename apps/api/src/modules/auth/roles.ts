import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { createAccessControl, type Role } from "better-auth/plugins/access";

const access = createAccessControl(defaultStatements);

/**
 * Two roles. `user` is what the admin plugin's default already means; `admin`
 * may promote and ban, because that is the point of the role (decision 0037).
 * The API's own gates read the role directly; this vocabulary is what Better
 * Auth's plugin checks, so a demoted account cannot reach its admin endpoints.
 */
export const ADMIN_ROLES = {
  admin: access.newRole(adminAc.statements),
  user: access.newRole(userAc.statements),
} as const satisfies Record<string, Role>;
