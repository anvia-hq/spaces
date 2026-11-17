import type { SandboxState } from "@spaces/shared/sandbox";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = {
  variant: "secondary" | "outline" | "destructive";
  dot: string;
  live?: boolean;
};

const TONES: Record<SandboxState, Tone> = {
  init: { variant: "outline", dot: "bg-muted-foreground/50" },
  provisioning: { variant: "outline", dot: "bg-muted-foreground", live: true },
  provisioned: { variant: "outline", dot: "bg-muted-foreground" },
  cloning: { variant: "outline", dot: "bg-muted-foreground", live: true },
  ready: { variant: "secondary", dot: "bg-foreground", live: true },
  idle: { variant: "secondary", dot: "bg-foreground", live: true },
  running: { variant: "secondary", dot: "bg-foreground", live: true },
  archiving: { variant: "outline", dot: "bg-muted-foreground", live: true },
  archived: { variant: "outline", dot: "bg-muted-foreground/50" },
  error: { variant: "destructive", dot: "bg-destructive" },
  cancelled: { variant: "outline", dot: "bg-muted-foreground/40" },
};

export function StateBadge({ state, className }: { state: SandboxState; className?: string }) {
  const tone = TONES[state];
  return (
    <Badge
      variant={tone.variant}
      className={cn("gap-1.5 rounded-full text-sm tracking-tight", className)}
    >
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", tone.dot, tone.live && "live-dot")}
      />
      {state}
    </Badge>
  );
}

export function Dot({ tone = "muted" }: { tone?: "primary" | "muted" | "danger" | "warning" }) {
  const map = {
    primary: "bg-primary",
    muted: "bg-muted-foreground",
    danger: "bg-destructive",
    warning: "bg-warning",
  } as const;
  return <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", map[tone])} />;
}
