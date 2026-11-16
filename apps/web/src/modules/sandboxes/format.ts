import { fmtDuration } from "@/lib/format.ts";

export function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();

  if (Number.isNaN(ms)) return "—";

  if (ms <= 0) return "due";

  return `in ${fmtDuration(Math.round(ms / 1000))}`;
}
