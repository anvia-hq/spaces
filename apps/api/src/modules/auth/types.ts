/** How the caller proved who they are; some routes only accept one of these. */
export type Credential = "operator" | "key" | "session";

/** Better Auth's admin plugin owns this column; `admin` is the one that acts. */
export type Role = string;

export const adminRole = "admin";

/** The only roles the API will set. Better Auth stores a comma-separated list. */
export type AdminRole = "admin" | "user";

export function isAdminRole(role: Role | null | undefined): boolean {
  return (role ?? "").split(",").includes(adminRole);
}

export type Principal =
  | { kind: "operator"; via: "operator" }
  | {
      kind: "user";
      via: "key" | "session";
      userId: string;
      email: string;
      name: string;
      role: Role;
      admin: boolean;
    };

export type AuthUser = { id: string; email: string; name: string; role: Role };

/** One row of the users table, as the admin routes return it. */
export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  admin: boolean;
  banned: boolean;
  createdAt: string;
}

export interface UserPage {
  users: ManagedUser[];
  total: number;
  limit: number;
  offset: number;
}

/** Which alternative sign-in providers the deployment can honour. */
export interface LoginConfig {
  github: boolean;
}

/** `GET /me`: the console reads `admin` to decide which surfaces to show. */
export interface MeAnswer {
  ok: true;
  type: "me";
  principal: Principal;
  operator: boolean;
  role: Role;
  admin: boolean;
  login: LoginConfig;
}
