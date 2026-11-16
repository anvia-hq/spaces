import { Notice } from "@/components/console/notice";
import { Panel } from "@/components/console/panel";
import { Tabs } from "@/components/console/tabs";
import { Skeleton } from "@/components/console/skeleton";
import { useUsage } from "../hooks/use-usage.ts";
import { WINDOWS } from "../windows.ts";
import { UsageBody } from "./usage-body.tsx";

export function UsagePanel({ sandboxId }: { sandboxId: string }) {
  const { range, setRange, usage, data } = useUsage(sandboxId);

  return (
    <Panel
      title="Machine time"
      subtitle="Billable seconds with the type multiplier applied. Time stopped is never counted."
      action={
        <Tabs
          inline
          tabs={WINDOWS.map((w) => ({ value: w.value, label: w.label }))}
          value={range}
          onChange={setRange}
        />
      }
    >
      {usage.error && !data && <Notice>{usage.error}</Notice>}

      {body()}
    </Panel>
  );

  function body() {
    if (data) return <UsageBody data={data} range={range} />;

    if (usage.loading) {
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[86px] rounded-xl" />
          <Skeleton className="h-[86px] rounded-xl" />
        </div>
      );
    }

    return null;
  }
}
