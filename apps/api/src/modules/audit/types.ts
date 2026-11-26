export type ActorKind = "operator" | "user" | "system";

export interface AuditEntry {
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
  ownerId?: string | null;
}

export interface AuditHint {
  targetId?: string;
  targetType?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}
