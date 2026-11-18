import { useState } from "react";
import { Server } from "lucide-react";
import { Notice } from "@/components/console/notice";
import { MetaLine, PageHeader } from "@/components/console/page-header";
import { Panel } from "@/components/console/panel";
import { Segmented } from "@/components/console/segmented";
import { Skeleton } from "@/components/console/skeleton";
import { useAuth } from "@/modules/auth/hooks/use-auth.ts";
import { type Runtimes, useRuntimes } from "../hooks/use-runtimes.ts";
import { type ClusterWindow, useClusterSamples } from "../hooks/use-cluster-samples.ts";
import { CapacityChart } from "./capacity-chart.tsx";
import { ClusterVerdict } from "./cluster-verdict.tsx";
import { PresetsPanel } from "./presets-panel.tsx";
import { RecentChanges } from "./recent-changes.tsx";
import { RegisterRuntimeDialog } from "./register-runtime-dialog.tsx";
import { RuntimeRow } from "./runtime-row.tsx";
import { TokenPanel } from "./token-panel.tsx";

const WINDOWS: { value: ClusterWindow; label: string }[] = [
  { value: "6h", label: "6 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
];

export function ClusterPage() {
  const { auth } = useAuth();
  const admin = auth.status === "signed-in" && auth.user.admin;
  const runtimes = useRuntimes();
  const [span, setSpan] = useState<ClusterWindow>("6h");
  const samples = useClusterSamples(span, runtimes.runtimes);
  const onlyBuiltIn = runtimes.runtimes.every((runtime) => runtime.kind === "local");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Cluster"
        icon={<Server />}
        actions={
          <>
            <MetaLine
              items={[runtimes.loading ? "loading" : `${runtimes.runtimes.length} runtimes`]}
            />
            {admin && (
              <RegisterRuntimeDialog busy={runtimes.busy === "create"} onCreate={runtimes.create} />
            )}
          </>
        }
      />

      <ClusterVerdict runtimes={runtimes.runtimes} live={samples.live} />

      <Panel
        title="Capacity"
        subtitle="Committed against reported, averaged over the whole cluster."
        action={
          <Segmented
            label="Window"
            value={span}
            options={WINDOWS}
            onChange={(value) => setSpan(value)}
          />
        }
      >
        <div className="grid gap-2.5 md:grid-cols-3">
          <CapacityChart
            label="Memory committed"
            points={samples.memory}
            top={100}
            unit="%"
            value={samples.live.memMib.toFixed(0)}
          />
          <CapacityChart
            label="vCPU committed"
            points={samples.cpu}
            top={100}
            unit="%"
            value={samples.live.vcpu.toFixed(0)}
          />
          <CapacityChart
            label="Sandboxes running"
            points={samples.running}
            top={Math.max(
              4,
              ...samples.running.map((point) => point.value),
              samples.live.sandboxes,
            )}
            unit="running"
            value={String(samples.live.sandboxes)}
          />
        </div>
        {samples.sampledAt === null && (
          <p className="mt-2 text-sm text-muted-foreground">
            Nothing sampled yet. History starts on the next tick
            {admin ? " (SPACES_SAMPLE_INTERVAL_MS)" : ""}.
          </p>
        )}
      </Panel>

      <Panel
        title="Runtimes"
        subtitle="The machines sandboxes run on. A new sandbox goes to the least loaded online runtime that is not draining."
        flush
      >
        {runtimes.error && (
          <div className="p-4">
            <Notice>{runtimes.error}</Notice>
          </div>
        )}

        {!runtimes.loading && onlyBuiltIn && (
          <div className="p-4">
            <Notice kind="info">
              Only the built-in runtime is registered.{" "}
              {admin
                ? "Use Register runtime to add another machine, then run the command it prints on that machine."
                : "An admin can register another machine."}
            </Notice>
          </div>
        )}

        {runtimes.issued && <TokenPanel issued={runtimes.issued} onHide={runtimes.clearIssued} />}

        <List runtimes={runtimes} admin={admin} />
      </Panel>

      <PresetsPanel admin={admin} />

      <RecentChanges />
    </div>
  );
}

function List({ runtimes, admin }: { runtimes: Runtimes; admin: boolean }) {
  if (runtimes.loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-9 w-full rounded-lg" />
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <ul role="list" className="divide-y divide-border/70 border-t border-border/70">
      {runtimes.runtimes.map((runtime) => (
        <RuntimeRow key={runtime.id} runtime={runtime} admin={admin} runtimes={runtimes} />
      ))}
    </ul>
  );
}
