import { Frame, FramePanel } from "@/components/reui/frame";
import { cn } from "@/lib/utils";

export function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Frame spacing="xs" className="w-full">
      <FramePanel className={cn("px-3.5 py-3", accent && "border-primary/30 bg-primary/5")}>
        <div className="text-base tracking-caps text-muted-foreground uppercase">{label}</div>
        <div
          className={cn(
            "mt-1.5 text-base leading-none font-medium tracking-brand",
            accent ? "text-primary" : "text-foreground",
          )}
          data-numeric
        >
          {value}
        </div>
        {hint && <div className="mt-2 text-base text-muted-foreground">{hint}</div>}
      </FramePanel>
    </Frame>
  );
}
