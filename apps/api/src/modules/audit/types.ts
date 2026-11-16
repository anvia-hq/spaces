export type ActorKind = "operator" | "user" | "system";

export interface AuditEntry {
  /** `sandbox.create`, `auth.sign_in`, … */
  action: string;
  actorKind: ActorKind;
  actorId?: string | null;
  actorLabel?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  result: "ok" | "error";
  status?: number | null;
  errorCode?: string | null;
  requestId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  durationMs?: number | null;
  metadata?: Record<string, unknown>;
  /** Whose log the row belongs to; null for the operator and system work. */
  ownerId?: string | null;
}

/** What a handler can tell the middleware that the request itself cannot. */
export interface AuditHint {
  targetId?: string;
  targetType?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}
