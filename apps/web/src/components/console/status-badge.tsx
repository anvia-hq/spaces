import { Badge } from "@/components/reui/badge";
import { cn } from "@/lib/utils";

/**
 * The one status pill.
 *
 * Semantics are carried by variant, so every `ok` in the app looks the same and
 * no call site invents its own colours: success, failure, in-progress and
 * neutral map onto `reui/badge`'s intent variants. The dot is the redundant
 * channel — it survives at small sizes and in monochrome, where hue alone
 * would not.
 */
export type StatusTone = "ok" | "error" | "warning" | "neutral";

const TONES: Record<
  StatusTone,
  {
    variant: "success-light" | "destructive-light" | "warning-light" | "outline";
    dot: string;
    live?: boolean;
  }
> = {
  ok: { variant: "success-light", dot: "bg-success" },
  error: { variant: "destructive-light", dot: "bg-destructive" },
  warning: { variant: "warning-light", dot: "bg-warning", live: true },
  neutral: { variant: "outline", dot: "bg-muted-foreground/60" },
};

export function StatusBadge({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
}) {
  const { variant, dot, live } = TONES[tone];

  return (
    <Badge variant={variant} size="sm" radius="full" className={cn("gap-1.5", className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", dot, live && "live-dot")} />
      {children}
    </Badge>
  );
}
