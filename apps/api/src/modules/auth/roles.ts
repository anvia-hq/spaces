import { adminAc, defaultStatements, userAc } from "better-auth/plugins/admin/access";
import { createAccessControl, type Role } from "better-auth/plugins/access";

const access = createAccessControl(defaultStatements);

export const ADMIN_ROLES = {
  admin: access.newRole(adminAc.statements),
  user: access.newRole(userAc.statements),
} as const satisfies Record<string, Role>;
