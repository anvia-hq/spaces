import type { ReactNode } from "react";
import { Button as ShadButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ButtonVariant } from "./types.ts";

const VARIANT: Record<ButtonVariant, "default" | "outline" | "ghost" | "destructive"> = {
  primary: "default",
  ghost: "outline",
  quiet: "ghost",
  danger: "destructive",
};

export function Button({
  children,
  onClick,
  variant = "ghost",
  size = "md",
  disabled,
  busy,
  type = "button",
  title,
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  title?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <ShadButton
      type={type}
      title={title}
      aria-label={ariaLabel}
      aria-busy={busy || undefined}
      onClick={onClick}
      disabled={disabled || busy}
      variant={VARIANT[variant]}
      size={size === "sm" ? "sm" : "default"}
      className={className}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </ShadButton>
  );
}
