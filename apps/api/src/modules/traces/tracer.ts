import { context, SpanStatusCode, trace, type Span, type Tracer } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { Resource } from "@opentelemetry/resources";
import type { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import {
  BatchSpanProcessor,
  BasicTracerProvider as Provider,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { config } from "../../config.ts";
import { PostgresSpanExporter } from "./exporter.ts";
import type { SpanRecord } from "./types.ts";

let provider: BasicTracerProvider | null = null;

/**
 * Start tracing once, with the writer that stores spans. Called from `app.ts`
 * so a test that imports the app traces like the server does; idempotent.
 */
export function startTracing(write: (spans: SpanRecord[]) => Promise<void>): void {
  if (provider || !config.traces.enabled) return;

  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();
  context.setGlobalContextManager(contextManager);

  provider = new Provider({
    resource: new Resource({ "service.name": "spaces" }),
    sampler: new TraceIdRatioBasedSampler(config.traces.sampleRate),
  });

  provider.addSpanProcessor(
    new BatchSpanProcessor(new PostgresSpanExporter(write), {
      scheduledDelayMillis: 2000,
      maxExportBatchSize: 200,
    }),
  );

  if (config.traces.otlpEndpoint) {
    provider.addSpanProcessor(
      new BatchSpanProcessor(new OTLPTraceExporter({ url: config.traces.otlpEndpoint }), {
        scheduledDelayMillis: 2000,
      }),
    );
  }

  trace.setGlobalTracerProvider(provider);
}

/** Tests and shutdown: hand everything buffered to the writer now. */
export async function flushTraces(): Promise<void> {
  await provider?.forceFlush();
}

export function tracer(): Tracer {
  return trace.getTracer("spaces");
}

/** A span around work that is not a proxy target: provisioning, stop, snapshot. */
export async function withSpan<T>(
  name: string,
  attributes: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  if (!config.traces.enabled) return fn();

  return tracer().startActiveSpan(name, async (span: Span) => {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== null && value !== undefined) span.setAttribute(key, value as never);
    }

    try {
      return await fn();
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  });
}
