import type { Runtime } from "@/lib/api.ts";

const gib = (mib: number) => (mib / 1024).toFixed(1);

export function capacityLabel(runtime: Runtime): string {
  if (!runtime.resources) return "capacity not reported";

  const { vcpu, memMib } = runtime.resources;
  const used = runtime.committed;

  return `${used.vcpu}/${vcpu} vCPU · ${gib(used.memMib)}/${gib(memMib)} GiB`;
}
