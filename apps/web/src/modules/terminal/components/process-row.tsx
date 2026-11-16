import { ConfirmButton } from "@/components/console/confirm-button";
import type { ProcessInfo } from "@/lib/api.ts";
import { fmtBytes } from "@/lib/format.ts";

export function ProcessRow({ process, onKill }: { process: ProcessInfo; onKill: () => void }) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <span className="w-9 shrink-0 text-base text-muted-foreground">{process.pid}</span>
      <div className="min-w-0 flex-1">
        <code className="block truncate text-base text-foreground/90">{process.command}</code>
        <span className="text-base text-muted-foreground">
          {process.user} · {fmtBytes(process.memoryMB * 1024 * 1024)}
        </span>
      </div>
      <ConfirmButton question="Kill?" confirmLabel="Kill" onConfirm={onKill}>
        Kill
      </ConfirmButton>
    </li>
  );
}
