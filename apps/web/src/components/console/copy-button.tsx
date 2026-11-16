import { useEffect, useState } from "react";
import { Button } from "./button.tsx";

export function CopyButton({
  value,
  label = "Copy",
  size = "sm",
}: {
  value: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const el = document.createElement("textarea");
      el.value = value;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
  }

  return (
    <Button variant="quiet" size={size} onClick={() => void copy()} ariaLabel={`Copy ${label}`}>
      <span aria-hidden className="text-base">
        {copied ? "✓" : "⧉"}
      </span>
      {copied ? "Copied" : label}
    </Button>
  );
}
