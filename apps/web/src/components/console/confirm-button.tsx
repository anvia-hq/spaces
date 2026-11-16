import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "./button.tsx";
import type { ButtonVariant } from "./types.ts";

export function ConfirmButton({
  children,
  confirmLabel = "Confirm",
  onConfirm,
  busy,
  variant = "danger",
  question = "Delete?",
}: {
  children: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  busy?: boolean;
  variant?: ButtonVariant;
  question?: string;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;

    const id = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(id);
  }, [armed]);

  if (!armed) {
    return (
      <Button variant={variant} busy={busy} onClick={() => setArmed(true)}>
        {children}
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-base text-muted-foreground">{question}</span>
      <Button
        variant={variant}
        size="sm"
        busy={busy}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="quiet" size="sm" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </span>
  );
}
