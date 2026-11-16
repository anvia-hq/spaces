/** How the caller proved who they are; some routes only accept one of these. */
export type Credential = "operator" | "key" | "session";

export type Principal =
  | { kind: "operator"; via: "operator" }
  | { kind: "user"; via: "key" | "session"; userId: string; email: string; name: string };

export type AuthUser = { id: string; email: string; name: string };
