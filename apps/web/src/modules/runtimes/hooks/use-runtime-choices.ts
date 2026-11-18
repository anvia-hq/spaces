import { api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function useRuntimeChoices() {
  const poll = usePoll(async () => (await api.listRuntimes()).runtimes, 15000);
  const choices = (poll.data ?? []).filter(
    (runtime) => runtime.state === "online" && !runtime.draining,
  );

  return { choices };
}
