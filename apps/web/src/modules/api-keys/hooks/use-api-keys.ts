import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type ApiKeyEntry } from "@/lib/api.ts";

export function useApiKeys() {
  const [keys, setKeys] = useState<ApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const answer = await api.listApiKeys();
      setKeys(answer.keys);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(name: string) {
    setBusy("create");
    try {
      const answer = await api.createApiKey(name);
      setCreated(answer.key);
      await load();
      toast.success(`Created ${answer.entry.name}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function revoke(entry: ApiKeyEntry) {
    setBusy(`revoke:${entry.id}`);
    try {
      await api.revokeApiKey(entry.id);
      await load();
      toast.success(`Revoked ${entry.name}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return { keys, loading, error, busy, created, setCreated, create, revoke };
}
