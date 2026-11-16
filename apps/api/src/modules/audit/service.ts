import { newId } from "@spaces/shared/errors";
import { now, store } from "../../db.ts";
import type { ActorKind, AuditEntry } from "./types.ts";

/** The only writer. There is deliberately no update or delete here. */
export async function record(entry: AuditEntry): Promise<void> {
  await store.insertAudit({
    id: newId("aud"),
    at: now(),
    actorKind: entry.actorKind,
    actorId: entry.actorId ?? null,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    result: entry.result,
    status: entry.status ?? null,
    errorCode: entry.errorCode ?? null,
    requestId: entry.requestId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    durationMs: entry.durationMs ?? null,
    metadata: entry.metadata ?? {},
    ownerId: entry.ownerId ?? null,
  });
}

export interface AuditFilter {
  action?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  result?: "ok" | "error";
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

/** `at` then `id`: pages do not shift while the log grows at the head. */
function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;

  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const parsed = at ? new Date(at) : null;

  if (!id || !parsed || Number.isNaN(parsed.getTime())) return null;

  return { at: parsed, id };
}

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

type Row = {
  id: string;
  at: Date;
  actorKind: string;
  actorId: string | null;
  actorLabel: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  result: string;
  status: number | null;
  errorCode: string | null;
  requestId: string | null;
  ip: string | null;
  userAgent: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown>;
};

export function shapeEntry(row: Row) {
  return {
    id: row.id,
    at: row.at.toISOString(),
    actor: { kind: row.actorKind as ActorKind, id: row.actorId, label: row.actorLabel },
    action: row.action,
    target: { type: row.targetType, id: row.targetId },
    result: row.result as "ok" | "error",
    status: row.status,
    errorCode: row.errorCode,
    requestId: row.requestId,
    ip: row.ip,
    userAgent: row.userAgent,
    durationMs: row.durationMs,
    metadata: row.metadata,
  };
}

export async function listAudit(filter: AuditFilter) {
  const limit = Math.min(filter.limit ?? 50, 200);
  const rows = await store.listAudit(filter, decodeCursor(filter.cursor), limit + 1);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];

  return {
    entries: page.map(shapeEntry),
    nextCursor: rows.length > limit && last ? encodeCursor(last.at, last.id) : null,
  };
}

export async function auditSummary() {
  return store.auditActions();
}
