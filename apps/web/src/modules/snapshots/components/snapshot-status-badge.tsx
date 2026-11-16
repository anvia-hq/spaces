import type { SavedSnapshot } from "@/lib/api.ts";
import { Badge } from "@/components/reui/badge";
import { cn } from "@/lib/utils";

export function SnapshotStatusBadge({
  status,
  size = "xs",
}: {
  status: SavedSnapshot["status"];
  size?: "xs" | "sm";
}) {
  const tone = {
    ready: { variant: "primary-light" as const, dot: "bg-primary" },
    failed: { variant: "destructive-light" as const, dot: "bg-destructive" },
    saving: { variant: "warning-light" as const, dot: "bg-warning" },
  }[status];
  return (
    <Badge variant={tone.variant} size={size} radius="full" className="gap-1.5 ">
      <span
        aria-hidden
        className={cn("size-1.5 rounded-full", tone.dot, status === "saving" && "live-dot")}
      />
      {status}
    </Badge>
  );
}
