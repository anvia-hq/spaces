import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { BetterAuthOptions } from "better-auth";
import { apiKey } from "@better-auth/api-key";
import { db } from "../../db.ts";
import { schema } from "@spaces/db";
import { config } from "../../config.ts";
import * as audit from "../audit/service.ts";

/**
 * GitHub is a provider only when the deployment set both halves of the pair:
 * an unset client id or secret leaves the key out of the map, and Better Auth
 * never learns the provider exists. A server with no GitHub app still boots,
 * and email + password still signs people in (docs/decision/0034).
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
 * alongside the operator key (docs/decision/0028).
 */
export const auth = betterAuth({
  appName: "spaces",
  basePath: "/api/auth",
  baseURL: config.auth.url,
  secret: config.auth.secret,
  trustedOrigins: [...config.auth.trustedOrigins],
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  socialProviders,
  session: {
    expiresIn: config.auth.sessionDays * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
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
        after: async (created) => {
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
  plugins: [
    apiKey({
      defaultPrefix: config.auth.keyPrefix,
      enableMetadata: false,
      rateLimit: { enabled: false },
    }),
  ],
});

export type Auth = typeof auth;
