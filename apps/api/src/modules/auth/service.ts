import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { admin } from "better-auth/plugins/admin";
import { db } from "../../db.ts";
import { schema } from "@spaces/db";
import { config } from "../../config.ts";
import * as audit from "../audit/service.ts";
import { promoteIfListed } from "./admins.ts";
import { ADMIN_ROLES } from "./roles.ts";

/**
 * GitHub is a provider only when the deployment set both halves of the pair:
 * an unset client id or secret leaves the key out of the map, and Better Auth
 * never learns the provider exists. A server with no GitHub app still boots,
 * and email + password still signs people in (docs/decision/0037).
 */
const socialProviders: BetterAuthOptions["socialProviders"] = config.auth.github.enabled
  ? {
      github: {
        clientId: config.auth.github.clientId,
        clientSecret: config.auth.github.clientSecret,
      },
    }
  : {};

/**
 * Better Auth owns the account tables and the `/api/auth/*` surface: sign-up,
 * sign-in, sign-out and the session cookie the console rides on. The API key
 * plugin adds user-owned keys, which the API accepts as a Bearer credential
 * alongside the operator key (docs/decision/0028). The admin plugin owns `role`
 * and `banned` on the user row, which is how an account acts as an operator
 * (docs/decision/0037).
 */
export const auth = betterAuth({
  appName: "spaces",
  basePath: "/api/auth",
  baseURL: config.auth.url,
  secret: config.auth.secret,
  trustedOrigins: [...config.auth.trustedOrigins],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  logger: { level: config.auth.debugLogging ? "debug" : "error" },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders,
  session: {
    expiresIn: config.auth.sessionDays * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    /**
     * Every authenticated `/api/v1` request re-reads the user row, so a role
     * change applies at once. Better Auth refused its own admin endpoints on a
     * session older than a day; the API's gates would not have, and two answers
     * to "is this admin" is one too many.
     */
    freshAge: 0,
  },
  /**
   * Authentication is audited here rather than in a route: Better Auth owns
   * `/api/auth/*`, so its hooks are the only place that sees a sign-in.
   */
  databaseHooks: {
    user: {
      create: {
        after: async (created) => {
          await audit.record({
            action: "auth.sign_up",
            actorKind: "user",
            actorId: created.id,
            actorLabel: created.email,
            targetType: "user",
            targetId: created.id,
            result: "ok",
            ownerId: created.id,
          });
        },
      },
    },
    session: {
      create: {
        after: async (created, context) => {
          await audit.record({
            action: "auth.sign_in",
            actorKind: "user",
            actorId: created.userId,
            targetType: "session",
            targetId: created.id,
            result: "ok",
            ip: created.ipAddress ?? null,
            userAgent: created.userAgent ?? null,
            ownerId: created.userId,
          });
          const promotion = await promoteIfListed(context, created.userId);

          if (promotion) await audit.record(promotion);
        },
      },
      delete: {
        after: async (removed) => {
          await audit.record({
            action: "auth.sign_out",
            actorKind: "user",
            actorId: removed.userId,
            targetType: "session",
            targetId: removed.id,
            result: "ok",
            ownerId: removed.userId,
          });
        },
      },
    },
  },
  /**
   * Better Auth's `/admin/*` endpoints stay off `/api/auth`: promoting and
   * banning is `/api/v1/users/*`, where one gate decides and the audit
   * middleware sees every change. The plugin stays for its schema and roles.
   */
  disabledPaths: [
    "/admin/set-role",
    "/admin/get-user",
    "/admin/create-user",
    "/admin/update-user",
    "/admin/list-users",
    "/admin/list-user-sessions",
    "/admin/unban-user",
    "/admin/ban-user",
    "/admin/impersonate-user",
    "/admin/stop-impersonating",
    "/admin/revoke-user-session",
    "/admin/revoke-user-sessions",
    "/admin/remove-user",
    "/admin/set-user-password",
    "/admin/has-permission",
  ],
  plugins: [
    apiKey({
      defaultPrefix: config.auth.keyPrefix,
      enableMetadata: false,
      rateLimit: { enabled: false },
    }),
    admin({ defaultRole: "user", adminRoles: ["admin"], roles: ADMIN_ROLES }),
  ],
});

export type Auth = typeof auth;
