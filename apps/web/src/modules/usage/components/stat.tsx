import { KpiCard } from "@/components/console/kpi-card";

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return <KpiCard label={label} value={value} hint={hint} />;
}
