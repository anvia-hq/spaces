import type { MiddlewareHandler } from "hono";
import { eq, user } from "@spaces/db";
import { config } from "./config.ts";
import { db, one } from "./db.ts";
import { type ApiEnv, fail } from "./errors.ts";
import { auth } from "./modules/auth/service.ts";
import type { AuthUser } from "./modules/auth/types.ts";
import { operatorScope, runInScope, userScope } from "./scope.ts";
import { isAdminRole } from "./modules/auth/types.ts";

function bearerOf(header: string | undefined): string {
  return (header ?? "").replace(/^Bearer\s+/i, "").trim();
}

async function userById(userId: string): Promise<AuthUser | null> {
  const row = await one(
    db
      .select({ id: user.id, email: user.email, name: user.name, role: user.role })
      .from(user)
      .where(eq(user.id, userId)),
  );
  return row ? { ...row, role: row.role ?? "user" } : null;
}

function unauthorized(c: Parameters<MiddlewareHandler<ApiEnv>>[0], message: string) {
  c.header(
    "WWW-Authenticate",
    'Bearer resource_metadata="/api/boat/.well-known/oauth-protected-resource"',
  );
  return fail(c, "unauthorized", message);
}

export const apiAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.req.path.startsWith("/api/v1/_transfer/") || c.req.path.startsWith("/api/v1/_preview/")) {
    return next();
  }

  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (session?.user) {
    const admin = isAdminRole(session.user.role);
    c.set("principal", {
      kind: "user",
      via: "session",
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role ?? "user",
      admin,
    });
    return runInScope(userScope(session.user.id), next);
  }

  const token = bearerOf(c.req.header("authorization"));

  if (token && config.apiKey && token === config.apiKey) {
    c.set("principal", { kind: "operator", via: "operator" });
    return runInScope(operatorScope, next);
  }

  if (token) {
    const verified = await auth.api.verifyApiKey({ body: { key: token } });
    const key = verified.key;

    if (!verified.valid || !key?.referenceId) {
      return unauthorized(c, "Invalid API key.");
    }

    const owner = await userById(key.referenceId);

    if (!owner) return unauthorized(c, "Invalid API key.");

    const admin = isAdminRole(owner.role);
    c.set("principal", {
      kind: "user",
      via: "key",
      userId: owner.id,
      email: owner.email,
      name: owner.name,
      role: owner.role,
      admin,
    });
    return runInScope(userScope(owner.id), next);
  }

  return unauthorized(c, "Missing bearer token. Sign in, or send `Authorization: Bearer <key>`.");
};
