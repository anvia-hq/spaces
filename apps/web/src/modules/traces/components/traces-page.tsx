import { useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/console/empty-state";
import { Notice } from "@/components/console/notice";
import { PageHeader } from "@/components/console/page-header";
import { Skeleton } from "@/components/console/skeleton";
import { Tabs } from "@/components/console/tabs";
import { KpiCard } from "@/components/console/kpi-card";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import type { TraceSummary } from "@/lib/api.ts";
import { cn } from "@/lib/utils";
import { useTraceSpans, useTraces } from "../hooks/use-traces.ts";
import { TraceDetail } from "./trace-detail.tsx";
import { TracesGrid, fmtLatency } from "./traces-grid.tsx";

const WINDOWS = [
  { value: "15", label: "15m" },
  { value: "60", label: "1h" },
  { value: "1440", label: "24h" },
] as const;

const ANY = "__any__";

export function TracesPage() {
  const { traces, metrics, loading, error, window, setWindow, status, setStatus, refresh } =
    useTraces();
  const detail = useTraceSpans();
  const [openTrace, setOpenTrace] = useState<TraceSummary | null>(null);

  function open(trace: TraceSummary) {
    setOpenTrace(trace);
    void detail.open(trace.traceId);
  }

  function close() {
    setOpenTrace(null);
    detail.close();
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Traces"
        icon={<Activity />}
        actions={
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={cn(loading && "animate-spin")} />
            Refresh
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          inline
          tabs={WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
          value={String(window)}
          onChange={(next) => setWindow(Number(next))}
        />
        <div className="w-[170px]">
          <Select
            value={status || ANY}
            onValueChange={(value) =>
              setStatus(value === ANY ? "" : (String(value) as "ok" | "error"))
            }
          >
            <SelectTrigger className="h-8 w-full">
              <span className="truncate">{status || "all requests"}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>all requests</SelectItem>
              <SelectItem value="ok">ok only</SelectItem>
              <SelectItem value="error">errors only</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && <Notice>{error}</Notice>}

      {metrics && <MetricsStrip metrics={metrics} />}

      {body()}

      <Dialog open={openTrace !== null} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle className="truncate ">{openTrace?.route ?? "Trace"}</DialogTitle>
          </DialogHeader>
          <TraceDetail
            traceId={openTrace?.traceId ?? ""}
            spans={detail.spans}
            loading={detail.loading}
            error={detail.error}
          />
        </DialogContent>
      </Dialog>
    </div>
  );

  function body() {
    if (loading && traces.length === 0) {
      return (
        <div className="flex flex-col gap-2 rounded-xl border border-border p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7 w-full rounded-md" />
          ))}
        </div>
      );
    }

    if (traces.length === 0) {
      return (
        <Card size="sm" className="gap-0 p-0">
          <div className="p-6">
            <EmptyState
              icon={<Activity className="size-4" />}
              title="Nothing traced"
              hint="No requests or spans have been recorded in this window yet."
            />
          </div>
        </Card>
      );
    }

    return <TracesGrid traces={traces} onOpen={open} />;
  }
}

function MetricsStrip({
  metrics,
}: {
  metrics: NonNullable<ReturnType<typeof useTraces>["metrics"]>;
}) {
  const errorRate = metrics.requests > 0 ? (metrics.errors / metrics.requests) * 100 : 0;

  const tiles = [
    {
      label: "requests",
      value: metrics.requests.toLocaleString(),
      hint: `last ${metrics.windowMinutes}m`,
    },
    { label: "errors", value: `${errorRate.toFixed(1)}%`, hint: `${metrics.errors} failed` },
    { label: "p50", value: fmtLatency(metrics.latencyP50Ms), hint: "median request" },
    { label: "p95", value: fmtLatency(metrics.latencyP95Ms), hint: "slow tail" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => (
          <KpiCard key={tile.label} label={tile.label} value={tile.value} hint={tile.hint} />
        ))}
      </div>

      {metrics.lifecycle.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-xl border border-border/70 bg-card/30 px-3.5 py-2 text-muted-foreground">
          <span className="text-foreground">sandbox lifecycle</span>
          {metrics.lifecycle.map((entry) => (
            <span key={entry.name} className="flex items-center gap-1.5">
              <span className="text-foreground/80">{entry.name.replace("sandbox.", "")}</span>
              <span>×{entry.count}</span>
              <span className="text-muted-foreground/70">
                p50 {fmtLatency(entry.p50Ms)} · p95 {fmtLatency(entry.p95Ms)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
