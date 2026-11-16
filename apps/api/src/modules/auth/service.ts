import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { apiKey } from "@better-auth/api-key";
import { db } from "../../db.ts";
import { schema } from "@spaces/db";
import { config } from "../../config.ts";
import * as audit from "../audit/service.ts";

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
