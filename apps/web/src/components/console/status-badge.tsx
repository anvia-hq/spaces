import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/components/console/tone.ts";

export type StatusTone = "ok" | "error" | "warning" | "neutral";

const TONES: Record<StatusTone, { className: string; dot: string; live?: boolean }> = {
  ok: { className: TONE_CLASS.success, dot: "bg-success" },
  error: { className: TONE_CLASS.destructive, dot: "bg-destructive" },
  warning: { className: TONE_CLASS.warning, dot: "bg-warning", live: true },
  neutral: { className: "text-muted-foreground", dot: "bg-muted-foreground/60" },
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const { className: toneClass, dot, live } = TONES[tone];

  return (
    <Badge variant="outline" className={cn("gap-1.5 rounded-full", toneClass, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot, live && "live-dot")} />
      {children}
    </Badge>
  );
}
