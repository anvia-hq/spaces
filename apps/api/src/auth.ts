import type { MiddlewareHandler } from "hono";
import { eq, user } from "@spaces/db";
import { config } from "./config.ts";
import { db, one } from "./db.ts";
import { type ApiEnv, fail } from "./errors.ts";
import { auth } from "./modules/auth/service.ts";
import type { AuthUser } from "./modules/auth/types.ts";
import { operatorScope, runInScope, userScope } from "./scope.ts";

function bearerOf(header: string | undefined): string {
  return (header ?? "").replace(/^Bearer\s+/i, "").trim();
}

async function userById(userId: string): Promise<AuthUser | null> {
  const row = await one(db.select().from(user).where(eq(user.id, userId)));
  return row ? { id: row.id, email: row.email, name: row.name } : null;
}

function unauthorized(c: Parameters<MiddlewareHandler<ApiEnv>>[0], message: string) {
  c.header(
    "WWW-Authenticate",
    'Bearer resource_metadata="/api/boat/.well-known/oauth-protected-resource"',
  );
  return fail(c, "unauthorized", message);
}

/**
 * Who the caller is, and what they may see. Three credentials are accepted:
 *
 * - the operator key (`SPACES_API_KEY`), which sees every sandbox — this is what
 *   existing clients and a fresh local install use;
 * - a Better Auth API key, which resolves to its owning user;
 * - a Better Auth session cookie, which is what the console uses after sign-in.
 *
 * The resolved scope rides on AsyncLocalStorage for the rest of the request, so
 * every read that could return another user's row is filtered in one place
 * (docs/decision/0028).
 */
export const apiAuth: MiddlewareHandler<ApiEnv> = async (c, next) => {
  if (c.req.path.startsWith("/api/v1/_transfer/") || c.req.path.startsWith("/api/v1/_preview/")) {
    return next();
  }

  // A browser that is signed in acts as that person, even if it also carries
  // the operator key (the console seeds one on localhost). Everything else —
  // curl, a CI job, an existing client — has no cookie and falls through.
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (session?.user) {
    c.set("principal", {
      kind: "user",
      via: "session",
      userId: session.user.id,
      email: session.user.email,
      name: session.user.name,
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

    c.set("principal", {
      kind: "user",
      via: "key",
      userId: owner.id,
      email: owner.email,
      name: owner.name,
    });
    return runInScope(userScope(owner.id), next);
  }

  return unauthorized(c, "Missing bearer token. Sign in, or send `Authorization: Bearer <key>`.");
};
