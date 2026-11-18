/**
 * Boat-compatible error envelope.
 * Shape taken from `ErrorEnvelope` in docs/boat-openapi.yaml — both a flat
 * set of fields and the nested `error` object, because boat returns both.
 */
export interface ErrorEnvelope {
  ok: false;
  type: string;
  status: number;
  code: string;
  message: string;
  requestId: string;
  error: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
  };
}

/** Error codes observed in the boat spec. Extra ones are additive, never renamed. */
export const ErrorCodes = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  retired_machine_size: 404,
  invalid_body: 400,
  invalid_query: 400,
  invalid_timeout: 400,
  invalid_env: 400,
  invalid_labels: 400,
  invalid_path: 400,
  file_too_large: 413,
  destination_exists: 409,
  sandbox_not_ready: 409,
  boat_starting: 409,
  snapshot_data_expired: 409,
  machine_class_plan_required: 403,
  rate_limited: 429,
  provider_not_configured: 501,
  boat_direct_failed: 502,
  runtime_unavailable: 503,
  not_implemented: 501,
  internal: 500,
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

export const RETRYABLE = new Set<ErrorCode>([
  "boat_starting",
  "rate_limited",
  "boat_direct_failed",
  "runtime_unavailable",
]);

export function errorEnvelope(
  code: ErrorCode,
  message: string,
  requestId: string,
  options: { type?: string; details?: Record<string, unknown> } = {},
): { status: number; body: ErrorEnvelope } {
  const status = ErrorCodes[code];
  const error: {
    code: string;
    message: string;
    status: number;
    details?: Record<string, unknown>;
  } = { code, message, status };

  if (options.details) error.details = options.details;

  return {
    status,
    body: {
      ok: false,
      type: options.type ?? "sandbox.error",
      status,
      code,
      message,
      requestId,
      error,
    },
  };
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * Boat ids use a Crockford-ish alphabet with no lookalike characters
 * (no 0/1/l/o/i) — see the `Sandbox.id` pattern. Match it so ids look native.
 */
const ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz";

export function newSandboxId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "bx_";
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}

export function newId(prefix: string, len = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = `${prefix}_`;
  for (const b of bytes) out += ID_ALPHABET[b % ID_ALPHABET.length];
  return out;
}
