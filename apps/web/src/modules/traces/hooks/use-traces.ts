import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type SpanRecord, type TraceMetrics, type TraceSummary } from "@/lib/api.ts";

export function useTraces() {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [metrics, setMetrics] = useState<TraceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState(60);
  const [status, setStatus] = useState<"" | "ok" | "error">("");

  const load = useCallback(async (windowMinutes: number, only: "" | "ok" | "error") => {
    setLoading(true);

    try {
      const [list, summary] = await Promise.all([
        api.traces({ limit: 40, status: only || undefined }),
        api.traceMetrics(windowMinutes),
      ]);
      setTraces(list.traces);
      setMetrics(summary);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(window, status);
  }, [load, window, status]);

  return {
    traces,
    metrics,
    loading,
    error,
    window,
    setWindow: (next: number) => setWindow(next),
    status,
    setStatus: (next: "" | "ok" | "error") => setStatus(next),
    refresh: () => void load(window, status),
  };
}

export function useTraceSpans() {
  const [spans, setSpans] = useState<SpanRecord[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open(traceId: string) {
    setLoading(true);

    try {
      const answer = await api.traceSpans(traceId);
      setSpans(answer.spans);
      setError(null);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : String(e);
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return { spans, loading, error, open, close: () => setSpans(null) };
}
