import { Gauge } from "lucide-react";
import type { SandboxUsage } from "@/lib/api.ts";
import { fmtDuration, fmtMoney } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import type { Window } from "../types.ts";
import { Stat } from "./stat.tsx";

export function UsageBody({ data, range }: { data: SandboxUsage; range: Window }) {
  const wall = data.seconds / (data.billingMultiplier || 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="billable seconds"
          value={data.seconds.toLocaleString()}
          hint={`${fmtDuration(wall)} wall clock`}
        />
        <Stat
          label="cost at list"
          value={fmtMoney(data.dollars)}
          hint={`${Math.round(data.secondsPerDollar).toLocaleString()} s per dollar`}
          accent
        />
        <Stat
          label="multiplier"
          value={`${data.billingMultiplier.toFixed(2)}×`}
          hint={`${data.sandboxType} machine`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/70 pt-3 text-base text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            className={cn(
              "size-1.5 rounded-full",
              data.running ? "bg-primary live-dot" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          {data.running ? "meter running" : "meter stopped"}
        </span>
        <span className="flex items-center gap-1.5">
          <Gauge className="size-3" />
          window {range}
        </span>
        <span className="ml-auto">
          {new Date(data.since).toLocaleString()} → {new Date(data.until).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
