import type { ReactNode } from "react";
import { Frame, FrameHeader, FramePanel, FrameTitle } from "@/components/reui/frame";
import { cn } from "@/lib/utils";

export function Panel({
  children,
  title,
  subtitle,
  action,
  className = "",
  bodyClassName = "",
  flush,
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  flush?: boolean;
}) {
  const hasHeader = Boolean(title || action);
  return (
    <Frame spacing="sm" className={className}>
      <FramePanel className="p-0">
        {hasHeader && (
          <FrameHeader className="flex flex-row items-center justify-between border-b border-border/80 px-3.5 py-2.5">
            <div className="min-w-0">
              {title && (
                <FrameTitle className="text-base font-medium tracking-tight text-foreground">
                  {title}
                </FrameTitle>
              )}
              {subtitle && <div className="mt-0.5 text-base text-muted-foreground">{subtitle}</div>}
            </div>
            {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
          </FrameHeader>
        )}
        <div className={flush ? "px-0" : cn("p-3.5", bodyClassName)}>{children}</div>
      </FramePanel>
    </Frame>
  );
}
