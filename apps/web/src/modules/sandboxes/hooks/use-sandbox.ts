import { useState } from "react";
import { toast } from "sonner";
import { ApiError, api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function useSandbox(sandboxId: string) {
  const poll = usePoll(() => api.getSandbox(sandboxId), 2000);
  const [busy, setBusy] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, done: string) {
    setBusy(key);
    try {
      await fn();
      await poll.refresh();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    setBusy("delete");
    try {
      await api.deleteSandbox(sandboxId);
      window.location.href = "/";
    } catch (e) {
      setBusy(null);
      toast.error(e instanceof ApiError ? e.message : String(e));
    }
  }

  return { poll, sandbox: poll.data?.sandbox, busy, act, remove };
}
