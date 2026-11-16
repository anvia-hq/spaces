export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  statusCode: "unset" | "ok" | "error";
  statusMessage: string | null;
  attributes: Record<string, unknown>;
  requestId: string | null;
  ownerId: string | null;
}

export interface TraceSummary {
  traceId: string;
  startedAt: string;
  durationMs: number;
  rootName: string;
  route: string | null;
  status: string;
  requestId: string | null;
  spanCount: number;
}

export interface TraceFilter {
  traceId?: string;
  requestId?: string;
  name?: string;
  status?: "ok" | "error";
  since?: string;
  limit?: number;
}
