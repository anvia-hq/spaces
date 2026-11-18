import { CopyButton } from "@/components/console/copy-button";
import { Notice } from "@/components/console/notice";
import { Button } from "@/components/ui/button";
import { installCommand } from "../install-command.ts";
import type { IssuedToken } from "../types.ts";

export function TokenPanel({ issued, onHide }: { issued: IssuedToken; onHide: () => void }) {
  const command = installCommand(window.location.origin, issued.token);

  return (
    <div className="border-t border-border/70 p-4">
      <Notice kind="warn">
        Token for {issued.runtime}. Shown once, only a hash is stored. Copy it now, then hide this.
      </Notice>
      <div className="mt-2.5 flex items-center gap-1.5">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-background px-2.5 py-1.5 text-base text-foreground">
          {issued.token}
        </code>
        <CopyButton value={issued.token} label="Copy token" />
        <Button size="sm" variant="ghost" onClick={onHide}>
          Hide
        </Button>
      </div>
      <p className="mt-3 text-base text-muted-foreground">
        Run this on the machine that will host it. It installs Bun and msb if they are missing, sets
        up a service, and runs again to update:
      </p>
      <div className="mt-1.5 flex items-start gap-1.5">
        <code className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-base break-all text-foreground">
          {command}
        </code>
        <CopyButton value={command} label="Copy command" />
      </div>
    </div>
  );
}
