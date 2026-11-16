import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, api, type SnapshotShare } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function useShares(name: string) {
  const shares = usePoll(() => api.snapshotShares(name), 8000);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    setCode(null);
  }, [name]);

  async function create() {
    setBusy(true);
    try {
      const result = await api.createShare(name);
      setCode(result.shareCode);
      await shares.refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(share: SnapshotShare) {
    setBusy(true);
    try {
      await api.revokeShare(name, share.id);
      await shares.refresh();
      toast.success("Share code revoked");
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return { shares, list: shares.data?.shares ?? [], busy, code, create, revoke };
}
