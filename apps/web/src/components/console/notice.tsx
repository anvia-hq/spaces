import type { ReactNode } from "react";
import { AlertCircle, AlertTriangle, Info } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { TONE_CLASS } from "@/components/console/tone.ts";

const NOTICE = {
  error: { tone: TONE_CLASS.destructive, title: "Error", icon: AlertCircle },
  warn: { tone: TONE_CLASS.warning, title: "Warning", icon: AlertTriangle },
  info: { tone: TONE_CLASS.accent, title: "Notice", icon: Info },
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
  const { tone, title, icon: Icon } = NOTICE[kind];
  return (
    <Alert className={cn("items-center", tone)}>
      <Icon />
      <AlertTitle className="sr-only">{title}</AlertTitle>
      <AlertDescription className="text-foreground">{children}</AlertDescription>
      {action && (
        <div className="col-start-2 mt-2 flex gap-1.5 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:justify-self-end">
          {action}
        </div>
      )}
    </Alert>
  );
}
