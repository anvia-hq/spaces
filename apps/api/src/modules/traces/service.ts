import { store } from "../../db.ts";
import type { SpanRecord, TraceFilter } from "./types.ts";

export async function recordSpans(spans: SpanRecord[]): Promise<void> {
  if (spans.length === 0) return;

  await store.insertSpans(spans);
}

export async function listTraces(filter: TraceFilter) {
  const limit = Math.min(filter.limit ?? 25, 100);
  return store.listTraces(filter, limit);
}

export async function traceSpans(traceId: string) {
  return store.spansOfTrace(traceId);
}

export async function metrics(windowMinutes = 60) {
  return store.traceMetrics(windowMinutes);
}
