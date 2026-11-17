import { Notice } from "@/components/console/notice";
import { CopyButton } from "@/components/console/copy-button";
import { Skeleton } from "@/components/console/skeleton";
import { Badge } from "@/components/ui/badge";
import type { SpanRecord } from "@/lib/api.ts";

import { cn } from "@/lib/utils";

/** Depth by parent chain, so the tree reads like a call stack. */
function depthOf(span: SpanRecord, byId: Map<string, SpanRecord>): number {
  let depth = 0;
  let current = span.parentSpanId ? byId.get(span.parentSpanId) : undefined;

  while (current && depth < 12) {
    depth += 1;
    current = current.parentSpanId ? byId.get(current.parentSpanId) : undefined;
  }

  return depth;
}

export function TraceDetail({
  traceId,
  spans,
  loading,
  error,
}: {
  traceId: string;
  spans: SpanRecord[] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2 border-t border-border/70 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-full rounded-md" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="border-t border-border/70 p-4">
        <Notice>{error}</Notice>
      </div>
    );
  }

  if (!spans || spans.length === 0) {
    return (
      <div className="border-t border-border/70 p-4 text-base text-muted-foreground">
        no spans for {traceId}
      </div>
    );
  }

  const byId = new Map(spans.map((span) => [span.spanId, span]));
  const widest = Math.max(...spans.map((span) => span.durationMs), 1);

  return (
    <div className="border-t border-border/70 bg-background/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-base tracking-wide text-muted-foreground uppercase">trace</span>
        <code className="text-base text-foreground/80">{traceId}</code>
        <CopyButton value={traceId} label="id" />
      </div>

      <ul role="list" className="flex flex-col">
        {spans.map((span) => {
          const depth = depthOf(span, byId);
          return (
            <li key={span.spanId} className="flex items-center gap-2 py-[3px]">
              <span
                className="min-w-0 truncate text-base text-foreground/90"
                style={{ paddingLeft: `${depth * 14}px` }}
                title={span.name}
              >
                {depth > 0 && <span className="text-muted-foreground/50">└ </span>}
                {span.name}
              </span>

              <span className="ml-auto flex shrink-0 items-center gap-2">
                {span.statusCode === "error" && (
                  <Badge variant="destructive" title={span.statusMessage ?? undefined}>
                    error
                  </Badge>
                )}
                <span className="w-20 shrink-0 text-right text-base text-muted-foreground">
                  {span.durationMs < 1000
                    ? `${Math.round(span.durationMs)}ms`
                    : `${(span.durationMs / 1000).toFixed(1)}s`}
                </span>
              </span>

              <span className="hidden w-[110px] shrink-0 sm:block" aria-hidden>
                <span
                  className={cn(
                    "block h-1 rounded-full",
                    span.statusCode === "error" ? "bg-destructive/70" : "bg-primary/50",
                  )}
                  style={{ width: `${Math.max(2, (span.durationMs / widest) * 100)}%` }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
