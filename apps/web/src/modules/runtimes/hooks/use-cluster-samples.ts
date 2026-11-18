import type { Runtime, RuntimeSample } from "@spaces/shared/runtime";
import { api } from "@/lib/api.ts";
import { usePoll } from "@/lib/use-poll.ts";

export type ClusterWindow = "6h" | "24h" | "7d";

export type Point = { at: string; value: number };

const MINUTES: Record<ClusterWindow, number> = { "6h": 360, "24h": 1_440, "7d": 10_080 };

type Bucket = {
  at: string;
  vcpu: number;
  memMib: number;
  capacityVcpu: number;
  capacityMemMib: number;
  running: number;
};

function bucket(samples: RuntimeSample[]): Bucket[] {
  const buckets = new Map<string, Bucket>();

  for (const sample of samples) {
    let entry = buckets.get(sample.at);

    if (!entry) {
      entry = { at: sample.at, vcpu: 0, memMib: 0, capacityVcpu: 0, capacityMemMib: 0, running: 0 };
      buckets.set(sample.at, entry);
    }

    entry.vcpu += sample.vcpuCommitted;
    entry.memMib += sample.memMibCommitted;
    entry.capacityVcpu += sample.vcpuCapacity ?? 0;
    entry.capacityMemMib += sample.memMibCapacity ?? 0;
    entry.running += sample.activeSandboxes;
  }

  return [...buckets.values()].sort((a, b) => a.at.localeCompare(b.at));
}

function percent(used: number, capacity: number): number {
  if (capacity <= 0) return 0;

  return Math.min(100, (used / capacity) * 100);
}

export function useClusterSamples(window: ClusterWindow, runtimes: Runtime[]) {
  const poll = usePoll(() => api.runtimeSamples(MINUTES[window]), 30_000);
  const buckets = bucket(poll.data?.samples ?? []);

  const memory: Point[] = buckets.map((entry) => ({
    at: entry.at,
    value: percent(entry.memMib, entry.capacityMemMib),
  }));
  const cpu: Point[] = buckets.map((entry) => ({
    at: entry.at,
    value: percent(entry.vcpu, entry.capacityVcpu),
  }));
  const running: Point[] = buckets.map((entry) => ({ at: entry.at, value: entry.running }));

  const latest = buckets.at(-1);

  return {
    poll,
    memory,
    cpu,
    running,
    live: {
      vcpu: percent(
        runtimes.reduce((sum, runtime) => sum + runtime.committed.vcpu, 0),
        runtimes.reduce((sum, runtime) => sum + (runtime.resources?.vcpu ?? 0), 0),
      ),
      memMib: percent(
        runtimes.reduce((sum, runtime) => sum + runtime.committed.memMib, 0),
        runtimes.reduce((sum, runtime) => sum + (runtime.resources?.memMib ?? 0), 0),
      ),
      sandboxes: runtimes.reduce((sum, runtime) => sum + runtime.activeSandboxes, 0),
      capacityVcpu: runtimes.reduce((sum, runtime) => sum + (runtime.resources?.vcpu ?? 0), 0),
      capacityMemMib: runtimes.reduce((sum, runtime) => sum + (runtime.resources?.memMib ?? 0), 0),
      committedVcpu: runtimes.reduce((sum, runtime) => sum + runtime.committed.vcpu, 0),
      committedMemMib: runtimes.reduce((sum, runtime) => sum + runtime.committed.memMib, 0),
    },
    sampledAt: latest?.at ?? null,
  };
}
