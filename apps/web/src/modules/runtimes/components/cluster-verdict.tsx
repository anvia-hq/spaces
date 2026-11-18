import { AGENT_VERSION, PROTOCOL_VERSION, type Runtime } from "@spaces/shared/runtime";
import { Notice } from "@/components/console/notice";
import { KpiCard } from "@/components/console/kpi-card";
import type { useClusterSamples } from "../hooks/use-cluster-samples.ts";

type Live = ReturnType<typeof useClusterSamples>["live"];

function gib(mib: number): string {
  return (mib / 1024).toFixed(1);
}

export function clusterAlerts(runtimes: Runtime[]): string[] {
  const alerts: string[] = [];

  for (const runtime of runtimes) {
    if (runtime.state !== "online" && runtime.totalSandboxes > 0) {
      alerts.push(
        `${runtime.name} is offline and still holds ${runtime.totalSandboxes} sandbox${runtime.totalSandboxes === 1 ? "" : "es"}.`,
      );
    }

    if (runtime.draining && runtime.activeSandboxes > 0) {
      alerts.push(
        `${runtime.name} is draining with ${runtime.activeSandboxes} running sandbox${runtime.activeSandboxes === 1 ? "" : "es"}.`,
      );
    }

    if (
      runtime.state === "online" &&
      runtime.agentVersion &&
      runtime.agentVersion !== AGENT_VERSION
    ) {
      alerts.push(
        `${runtime.name} runs agent ${runtime.agentVersion}; this control plane expects ${AGENT_VERSION}.`,
      );
    }

    if (
      runtime.state === "online" &&
      runtime.protocol !== null &&
      runtime.protocol !== PROTOCOL_VERSION
    ) {
      alerts.push(
        `${runtime.name} speaks protocol ${runtime.protocol}; this control plane speaks ${PROTOCOL_VERSION}.`,
      );
    }
  }

  return alerts;
}

function verdictSentence(online: number, total: number, accepting: boolean): string {
  if (!accepting) return "Refusing new work: every runtime is offline or draining.";

  if (online === total) return `Accepting work: ${online} of ${total} runtimes online.`;

  return `Accepting work on ${online} of ${total} runtimes; the rest are offline or draining.`;
}

export function ClusterVerdict({ runtimes, live }: { runtimes: Runtime[]; live: Live }) {
  const online = runtimes.filter((runtime) => runtime.state === "online").length;
  const alerts = clusterAlerts(runtimes);
  const tight = live.memMib >= 85 || live.vcpu >= 85;
  const accepting =
    online > 0 && runtimes.some((runtime) => !runtime.draining && runtime.state === "online");

  return (
    <div className="flex flex-col gap-3">
      <p className="max-w-3xl text-base text-muted-foreground">
        {verdictSentence(online, runtimes.length, accepting)}
        {tight && " Capacity is nearly committed — the next create may be refused for room."}
      </p>

      {alerts.length > 0 && (
        <Notice kind="warn">
          <ul className="flex flex-col gap-1">
            {alerts.map((alert) => (
              <li key={alert}>{alert}</li>
            ))}
          </ul>
        </Notice>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Runtimes online"
          value={`${online}/${runtimes.length}`}
          hint="dialling out"
        />
        <KpiCard
          label="Memory committed"
          value={`${live.memMib.toFixed(0)}%`}
          hint={`${gib(live.committedMemMib)} of ${gib(live.capacityMemMib)} GiB`}
        />
        <KpiCard
          label="vCPU committed"
          value={`${live.vcpu.toFixed(0)}%`}
          hint={`${live.committedVcpu} of ${live.capacityVcpu} vCPU`}
        />
        <KpiCard
          label="Sandboxes running"
          value={String(live.sandboxes)}
          hint="reservations, not load average"
        />
      </div>
    </div>
  );
}
