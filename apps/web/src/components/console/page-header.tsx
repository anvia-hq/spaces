import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  icon,
  actions,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-8 gap-y-4 border-b pb-4",
        className,
      )}
    >
      <div className="flex min-w-0 max-w-2xl items-center gap-2.5">
        {icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground [&_svg]:size-4">
            {icon}
          </span>
        )}
        <h1 className="text-xl font-semibold tracking-heading text-foreground">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function MetaLine({ items }: { items: (ReactNode | null | false | undefined)[] }) {
  const present = items.filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-base text-muted-foreground">
      {present.map((item, i) => (
        <span key={i} className="flex items-center gap-x-2.5">
          {i > 0 && (
            <span aria-hidden className="text-border">
              /
            </span>
          )}
          {item}
        </span>
      ))}
    </div>
  );
}
