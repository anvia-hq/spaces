import { useState } from "react";
import { api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";
import type { Window } from "../types.ts";

function sinceFor(window: Window): string | undefined {
  if (window === "all") return undefined;

  const ms = window === "24h" ? 24 * 3600_000 : 3600_000;
  return new Date(Date.now() - ms).toISOString();
}

export function useUsage(sandboxId: string) {
  const [range, setRange] = useState<Window>("all");
  const usage = usePoll(() => api.usage(sandboxId, { since: sinceFor(range) }), 5000);
  return { range, setRange, usage, data: usage.data };
}
