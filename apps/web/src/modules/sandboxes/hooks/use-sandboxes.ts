import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { SandboxType } from "@spaces/shared/sandbox";
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

  const create = (input: { type: SandboxType; ttlSeconds: number | null; name?: string }) =>
    act("create", () => api.createSandbox(input), "Sandbox created").then(() => undefined);

  return { poll, rows, live, busy, act, create };
}
