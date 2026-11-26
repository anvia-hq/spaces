import type { MachineSize } from "@spaces/shared/sandbox";
import { api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export function useMachineSizes() {
  const poll = usePoll(() => api.machineSizes(), 30_000);
  const sizes: MachineSize[] = poll.data?.sizes ?? [];

  const byName = new Map(sizes.map((size) => [size.name, size]));

  return { poll, sizes, byName };
}
