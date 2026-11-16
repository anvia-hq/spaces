import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type AuditEntry } from "@/lib/api.ts";

export type AuditFilters = { action: string; result: "" | "ok" | "error"; targetId: string };

const EMPTY: AuditFilters = { action: "", result: "", targetId: "" };

export function useAuditLog() {
  const [filters, setFilters] = useState<AuditFilters>(EMPTY);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (next: AuditFilters, from: string | null, append: boolean) => {
    if (append) setMore(true);
    else setLoading(true);

    try {
      const page = await api.auditLog({
        action: next.action || undefined,
        result: next.result || undefined,
        targetId: next.targetId.trim() || undefined,
        cursor: from ?? undefined,
        limit: 50,
      });

      setEntries((before) => (append ? [...before, ...page.entries] : page.entries));
      setCursor(page.nextCursor);
      setError(null);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : String(e);
      setError(message);

      if (append) toast.error(message);
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, []);

  useEffect(() => {
    void load(EMPTY, null, false);
  }, [load]);

  useEffect(() => {
    void api
      .auditActions()
      .then((answer) => setActions(answer.actions))
      .catch(() => setActions([]));
  }, []);

  function update(patch: Partial<AuditFilters>) {
    const next = { ...filters, ...patch };
    setFilters(next);
    void load(next, null, false);
  }

  return {
    filters,
    update,
    entries,
    actions,
    hasMore: cursor !== null,
    loading,
    more,
    error,
    loadMore: () => void load(filters, cursor, true),
    refresh: () => void load(filters, null, false),
  };
}
