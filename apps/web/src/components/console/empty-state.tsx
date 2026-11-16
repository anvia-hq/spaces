import type { ReactNode } from "react";
import { IconTile } from "@/components/reui/icon-tile";

export function EmptyState({
  glyph = "▣",
  icon,
  title,
  hint,
  action,
}: {
  glyph?: string;
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <IconTile variant="frame" size="lg" aria-hidden="true" className="text-muted-foreground">
        {icon ?? glyph}
      </IconTile>
      <p className="mt-3 text-base font-medium text-foreground">{title}</p>
      {hint && (
        <p className="mt-1 max-w-sm text-base leading-relaxed text-muted-foreground">{hint}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
