import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function KpiCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-0 p-0">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground [&_svg]:size-3.5">
          {icon}
          <span>{label}</span>
        </div>
        <div className="text-2xl leading-none font-semibold tracking-heading text-foreground tabular-nums">
          {value}
        </div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
    </Card>
  );
}
