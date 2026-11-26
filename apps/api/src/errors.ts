import { HTTPException } from "hono/http-exception";
import { isAPIError } from "better-auth/api";
import type { Context, ValidationTargets } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { errorEnvelope, type ErrorCode } from "@spaces/shared/errors";
import type { RuntimeRow } from "@spaces/db";
import type { Principal } from "./modules/auth/types.ts";
import type { AuditHint } from "./modules/audit/types.ts";

export type ApiEnv = {
  Variables: {
    requestId: string;
    principal: Principal;
    audit?: AuditHint;
    agentRuntime?: RuntimeRow;
  };
};

export class ServiceError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "sandbox_not_ready"
      | "invalid_body"
      | "invalid_query"
      | "invalid_path"
      | "invalid_network_policy"
      | "network_policy_unsupported"
      | "provider_not_configured"
      | "file_too_large"
      | "destination_exists"
      | "forbidden"
      | "internal",
    message: string,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export class DriverUnsupported extends Error {
  constructor(
    readonly operation: string,
    readonly reason: string,
  ) {
    super(`${operation} is not available: ${reason}`);
    this.name = "DriverUnsupported";
  }
}

export class DriverFailure extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "DriverFailure";
  }
}

export class RuntimeUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeUnavailable";
  }
}

export function fail(c: Context<ApiEnv>, code: ErrorCode, message: string) {
  const { status, body } = errorEnvelope(code, message, c.get("requestId"));
  return c.json(body, status as never);
}

export function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) =>
      issue.code === "unrecognized_keys"
        ? `invalid_query: unknown parameter${issue.keys.length > 1 ? "s" : ""} ${issue.keys
            .map((k) => `\`${k}\``)
            .join(", ")}`
        : `${issue.path.join(".") || "body"}: ${issue.message}`,
    )
    .join("; ");
}

const HTTP_CODE: Record<number, ErrorCode> = {
  400: "invalid_body",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "sandbox_not_ready",
  413: "file_too_large",
};

const SERVICE_CODES = {
  not_found: "not_found",
  sandbox_not_ready: "sandbox_not_ready",
  invalid_body: "invalid_body",
  invalid_query: "invalid_query",
  invalid_path: "invalid_path",
  invalid_network_policy: "invalid_network_policy",
  network_policy_unsupported: "network_policy_unsupported",
  file_too_large: "file_too_large",
  destination_exists: "destination_exists",
  provider_not_configured: "provider_not_configured",
  forbidden: "forbidden",
  internal: "internal",
} as const satisfies Record<ServiceError["code"], ErrorCode>;

function guestReason(error: DriverFailure) {
  const reason = error.message;

  if (reason.includes("ENOENT")) return { code: "not_found" as const, message: reason };

  if (reason.includes("EEXIST")) {
    return {
      code: "destination_exists" as const,
      message: "destination already exists; pass overwrite=true",
    };
  }

  if (reason.includes("ENOTDIR") || reason.includes("EISDIR")) {
    return { code: "invalid_path" as const, message: reason };
  }

  if (reason.includes("EBADPATH")) {
    return {
      code: "invalid_path" as const,
      message: reason.replace(/^guest operation failed:\s*/, ""),
    };
  }

  if (reason.includes("EPROTECTED")) {
    return {
      code: "invalid_path" as const,
      message: "refusing to delete a sandbox root directory",
    };
  }

  return { code: "boat_direct_failed" as const, message: reason };
}

export function errorHandler(error: Error, c: Context<ApiEnv>) {
  if (isAPIError(error)) {
    const status = Number((error as { status?: number }).status ?? 400);
    const message =
      (error as { body?: { message?: string } }).body?.message ??
      error.message ??
      "Request failed.";
    return fail(c, HTTP_CODE[status] ?? (status < 500 ? "invalid_body" : "internal"), message);
  }

  if (error instanceof HTTPException) {
    const message = error.message || "Request failed.";
    return fail(c, HTTP_CODE[error.status] ?? "internal", message);
  }

  if (error instanceof ServiceError) {
    return fail(c, SERVICE_CODES[error.code], error.message);
  }

  if (error instanceof RuntimeUnavailable) {
    return fail(c, "runtime_unavailable", error.message);
  }

  if (error instanceof DriverUnsupported) {
    return fail(c, "provider_not_configured", error.message);
  }

  if (error instanceof DriverFailure) {
    const reason = guestReason(error);
    return fail(c, reason.code, reason.message);
  }

  if (error instanceof z.ZodError) {
    return fail(c, "invalid_body", formatZodError(error));
  }

  console.error("[api] unhandled", error);
  return fail(c, "internal", error instanceof Error ? error.message : "unexpected error");
}

export function validate<T extends z.ZodTypeAny, Target extends keyof ValidationTargets>(
  target: Target,
  schema: T,
) {
  return zValidator(target, schema, (result) => {
    if (result.success) return;

    const issues = result.error.issues;
    const badPath = issues.some((i) => i.message.startsWith("invalid_path:"));
    const badQuery = target === "query" || issues.some((i) => i.code === "unrecognized_keys");

    let code: ServiceError["code"] = "invalid_body";

    if (badPath) code = "invalid_path";
    else if (badQuery) code = "invalid_query";

    throw new ServiceError(code, formatZodError(result.error));
  });
}
