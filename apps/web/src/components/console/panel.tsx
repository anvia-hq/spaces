import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card size="sm" className={cn("gap-0 p-0", className)}>
      {hasHeader && (
        <CardHeader className="border-b py-2.5">
          {title && <CardTitle className="text-sm font-semibold tracking-tight">{title}</CardTitle>}
          {subtitle && <CardDescription>{subtitle}</CardDescription>}
          {action && <CardAction className="flex items-center gap-1.5">{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={cn(flush ? "px-0" : "p-3.5", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}
