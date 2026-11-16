import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type SavedSnapshot } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function useSavedSnapshotList() {
  const saved = usePoll(() => api.savedSnapshots(), 4000);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function remove(entry: SavedSnapshot) {
    setBusy(`del:${entry.name}`);
    try {
      await api.deleteSavedSnapshot(entry.name);

      if (expanded === entry.name) setExpanded(null);

      await saved.refresh();
      toast.success(`Snapshot ${entry.name} deleted`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return { saved, busy, expanded, setExpanded, remove };
}
