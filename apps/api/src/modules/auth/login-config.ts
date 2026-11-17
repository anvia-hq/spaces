import { config } from "../../config.ts";

/**
 * Which alternative sign-in providers this deployment has credentials for.
 *
 * Exactly the flag the Better Auth provider is registered on, read from the
 * same `config.auth.github`, so the console cannot offer a button for a
 * provider the server would answer `404` on (docs/decision/0034).
 */
export function loginConfig() {
  return { github: config.auth.github.enabled };
}
