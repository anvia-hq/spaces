import { auth } from "../auth/service.ts";
import type { AuthUser } from "../auth/types.ts";

/** A key as the console shows it: never the secret, only its start. */
function shape(row: {
  id: string;
  name: string | null;
  start: string | null;
  createdAt: Date;
  lastRequest: Date | null;
  expiresAt: Date | null;
  enabled: boolean | null;
}) {
  return {
    id: row.id,
    name: row.name ?? "",
    start: row.start ?? "",
    createdAt: new Date(row.createdAt).toISOString(),
    lastUsedAt: row.lastRequest ? new Date(row.lastRequest).toISOString() : null,
    expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    enabled: row.enabled !== false,
  };
}

export async function listApiKeys(headers: Headers) {
  const answer = await auth.api.listApiKeys({ query: { limit: 100 }, headers });
  return answer.apiKeys.map((row) => shape(row));
}

/** The secret comes back exactly once, at creation; only a hash is stored. */
export async function createApiKey(headers: Headers, user: AuthUser, name: string) {
  const created = await auth.api.createApiKey({ body: { name, userId: user.id }, headers });
  return { key: created.key, entry: shape(created) };
}

export async function revokeApiKey(headers: Headers, keyId: string) {
  await auth.api.deleteApiKey({ body: { keyId }, headers });
  return { id: keyId, status: "revoked" as const };
}
