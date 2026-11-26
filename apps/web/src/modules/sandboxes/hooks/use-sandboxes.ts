import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { NetworkPolicy, SandboxType } from "@spaces/shared/sandbox";
import { ApiError, LIVE_STATES, api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";
import type { Act } from "../types.ts";

export function useSandboxes() {
  const poll = usePoll(() => api.listSandboxes(), 2000);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = poll.data?.sandboxes ?? [];
  const live = rows.filter((s) => LIVE_STATES.includes(s.state)).length;
  const refresh = poll.refresh;

  const act: Act = useCallback(
    async (key, fn, done) => {
      setBusy(key);
      try {
        await fn();
        await refresh();
        toast.success(done);
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const create = useCallback(
    async (input: {
      type: SandboxType;
      ttlSeconds: number | null;
      name?: string;
      runtime?: string;
      network?: NetworkPolicy;
    }): Promise<boolean> => {
      setBusy("create");
      try {
        await api.createSandbox(input);
        await refresh();
        toast.success("Sandbox created");
        return true;
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : String(e));
        return false;
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  return { poll, rows, live, busy, act, create };
}
