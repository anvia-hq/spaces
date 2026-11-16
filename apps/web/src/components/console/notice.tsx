import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/reui/alert";

const NOTICE = {
  error: { variant: "destructive", title: "Error", icon: AlertCircle },
  warn: { variant: "warning", title: "Warning", icon: AlertTriangle },
  info: { variant: "info", title: "Notice", icon: Info },
} as const;

export function Notice({
  kind = "error",
  children,
  action,
}: {
  kind?: "error" | "warn" | "info";
  children: ReactNode;
  action?: ReactNode;
}) {
  const { variant, title, icon: Icon } = NOTICE[kind];
  return (
    <Alert variant={variant}>
      <Icon className="size-4" />
      <AlertTitle className="sr-only">{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
      {action && <AlertAction>{action}</AlertAction>}
    </Alert>
  );
}
