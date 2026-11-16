import { SpanKind } from "@opentelemetry/api";
import type { ExportResult } from "@opentelemetry/core";
import { ExportResultCode, hrTimeToMilliseconds } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import type { SpanRecord } from "./types.ts";

const MAX_ATTRIBUTE_LENGTH = 2000;

const KINDS: Record<number, string> = {
  [SpanKind.INTERNAL]: "internal",
  [SpanKind.SERVER]: "server",
  [SpanKind.CLIENT]: "client",
  [SpanKind.PRODUCER]: "producer",
  [SpanKind.CONSUMER]: "consumer",
};

/** Long strings (a command line, a URL) are truncated, never stored whole. */
function clamp(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_ATTRIBUTE_LENGTH ? `${value.slice(0, MAX_ATTRIBUTE_LENGTH)}…` : value;
  }

  if (Array.isArray(value)) return value.slice(0, 20);

  return value;
}

function statusOf(code: number): "ok" | "error" | "unset" {
  if (code === 2) return "error";

  return code === 1 ? "ok" : "unset";
}

function toRecord(span: ReadableSpan): SpanRecord {
  const attributes: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(span.attributes)) {
    attributes[key] = clamp(value);
  }

  const startedAt = hrTimeToMilliseconds(span.startTime);
  const endedAt = hrTimeToMilliseconds(span.endTime ?? span.startTime);
  const requestId = span.attributes["spaces.request_id"];
  const ownerId = span.attributes["spaces.owner_id"];

  return {
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanId ?? null,
    name: span.name,
    kind: KINDS[span.kind] ?? "internal",
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: Math.max(0, Math.round(endedAt - startedAt)),
    statusCode: statusOf(span.status.code),
    statusMessage: span.status.message ?? null,
    attributes,
    requestId: typeof requestId === "string" ? requestId : null,
    ownerId: typeof ownerId === "string" ? ownerId : null,
  };
}

/**
 * Spans into the same Postgres as everything else, so a self-hosted server can
 * explain itself without a collector (decision 0032).
 */
export class PostgresSpanExporter implements SpanExporter {
  constructor(private readonly write: (spans: SpanRecord[]) => Promise<void>) {}

  async export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void) {
    try {
      await this.write(spans.map(toRecord));
      resultCallback({ code: ExportResultCode.SUCCESS });
    } catch (error) {
      resultCallback({ code: ExportResultCode.FAILED, error: error as Error });
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
