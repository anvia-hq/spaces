import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type SavedSnapshot } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";
import { suggestName } from "../names.ts";

export function useSandboxSnapshots(sandboxId: string) {
  const saved = usePoll(() => api.savedSnapshots(), 5000);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState<string | null>(null);

  const mine = (saved.data?.snapshots ?? []).filter((s) => s.sourceSandboxId === sandboxId);

  async function save() {
    const target = (name.trim() || suggestName(sandboxId)).toLowerCase();
    setBusy("save");
    setError(null);
    try {
      const result = await api.saveSnapshot(sandboxId, target);
      setName("");
      await saved.refresh();
      toast.success(`Saved ${result.snapshot.name}`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove(entry: SavedSnapshot) {
    setBusy(`del:${entry.name}`);
    setError(null);
    try {
      await api.deleteSavedSnapshot(entry.name);

      if (browsing === entry.name) setBrowsing(null);

      await saved.refresh();
      toast.success(`Deleted ${entry.name}`);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
    } finally {
      setBusy(null);
    }
  }

  return { saved, name, setName, busy, error, browsing, setBrowsing, mine, save, remove };
}
