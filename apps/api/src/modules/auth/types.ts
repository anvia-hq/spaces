export type Credential = "operator" | "key" | "session";

export type Role = string;

export const adminRole = "admin";

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

export interface LoginConfig {
  github: boolean;
}

export interface MeAnswer {
  ok: true;
  type: "me";
  principal: Principal;
  operator: boolean;
  role: Role;
  admin: boolean;
  login: LoginConfig;
}
