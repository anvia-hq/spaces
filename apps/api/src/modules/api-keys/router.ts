import { Hono } from "hono";
import type { Context } from "hono";
import { type ApiEnv, fail, validate } from "../../errors.ts";
import type { AuthUser } from "../auth/types.ts";
import { CreateApiKeyRequest } from "./schema.ts";
import { createApiKey, listApiKeys, revokeApiKey } from "./service.ts";

/**
 * Keys are managed by a signed-in person, never by a key: a leaked key must not
 * be able to mint another. The operator key answers 403 here with the reason.
 */
function signedIn(c: Context<ApiEnv>): AuthUser | null {
  const principal = c.get("principal");

  if (principal.kind !== "user" || principal.via !== "session") return null;

  return { id: principal.userId, email: principal.email, name: principal.name };
}

const NO_USER = "Sign in to manage API keys; a key or the operator key cannot create them.";

export const apiKeysRouter = new Hono<ApiEnv>()
  .get("/api-keys", async (c) => {
    const user = signedIn(c);

    if (!user) return fail(c, "forbidden", NO_USER);

    return c.json({
      ok: true as const,
      type: "api_key.list" as const,
      keys: await listApiKeys(c.req.raw.headers),
    });
  })
  .post("/api-keys", validate("json", CreateApiKeyRequest), async (c) => {
    const user = signedIn(c);

    if (!user) return fail(c, "forbidden", NO_USER);

    const created = await createApiKey(c.req.raw.headers, user, c.req.valid("json").name);

    c.set("audit", {
      targetId: created.entry.id,
      targetType: "api_key",
      metadata: { name: created.entry.name, start: created.entry.start },
    });

    return c.json(
      {
        ok: true as const,
        type: "api_key.created" as const,
        key: created.key,
        entry: created.entry,
      },
      201,
    );
  })
  .delete("/api-keys/:keyId", async (c) => {
    const user = signedIn(c);

    if (!user) return fail(c, "forbidden", NO_USER);

    const revoked = await revokeApiKey(c.req.raw.headers, c.req.param("keyId"));
    return c.json({ ok: true as const, type: "api_key.revoked" as const, ...revoked });
  });
