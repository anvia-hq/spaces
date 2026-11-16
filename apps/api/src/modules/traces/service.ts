import { store } from "../../db.ts";
import type { SpanRecord, TraceFilter } from "./types.ts";

/** The only writer: the exporter hands finished spans here, in batches. */
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

/** Requests per minute, error rate, latency and lifecycle durations. */
export async function metrics(windowMinutes = 60) {
  return store.traceMetrics(windowMinutes);
}
