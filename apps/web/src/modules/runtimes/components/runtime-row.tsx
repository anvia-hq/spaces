import { KeyRound, Pause, Play, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { Runtime } from "@/lib/api.ts";
import { timeAgo } from "@/lib/format.ts";
import { cn } from "@/lib/utils";
import type { Runtimes } from "../hooks/use-runtimes.ts";
import { capacityLabel } from "../capacity.ts";
import { EditCapDialog } from "./edit-cap-dialog.tsx";
import { RenameRuntimeDialog } from "./rename-runtime-dialog.tsx";

export function RuntimeRow({
  runtime,
  admin,
  runtimes,
}: {
  runtime: Runtime;
  admin: boolean;
  runtimes: Runtimes;
}) {
  const online = runtime.state === "online";
  const builtIn = runtime.kind === "local";
  const busy = runtimes.busy?.endsWith(runtime.id) === true;
  const cap = runtime.maxSandboxes === null ? "no cap" : `cap ${runtime.maxSandboxes}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="min-w-0 truncate text-base font-medium text-foreground">{runtime.name}</span>
      <Badge variant={online ? "secondary" : "outline"} className="gap-1.5 rounded-full">
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            online ? "live-dot bg-foreground" : "bg-muted-foreground/50",
          )}
        />
        {runtime.state}
      </Badge>
      {runtime.draining && <Badge variant="outline">draining</Badge>}
      {builtIn && <Badge variant="outline">built-in</Badge>}
      <span className="min-w-0 basis-full break-words text-base text-muted-foreground sm:basis-auto">
        {runtime.driver ?? "no driver"} · {runtime.activeSandboxes}/{runtime.totalSandboxes}{" "}
        sandboxes · {cap} · {capacityLabel(runtime)}
        {runtime.publicHost && ` · ${runtime.publicHost}`}
        {runtime.agentVersion && ` · v${runtime.agentVersion}`}
        {" · seen "}
        {online ? "now" : timeAgo(runtime.lastSeenAt)}
      </span>

      {admin && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void runtimes.setDraining(runtime, !runtime.draining)}
          >
            {busy && <Spinner className="size-3.5" />}
            {!busy && runtime.draining && <Play className="size-3.5" />}
            {!busy && !runtime.draining && <Pause className="size-3.5" />}
            {runtime.draining ? "Resume" : "Drain"}
          </Button>
          <RenameRuntimeDialog
            runtime={runtime}
            busy={busy}
            onSave={(value) => void runtimes.rename(runtime, value)}
          />
          <EditCapDialog
            runtime={runtime}
            busy={busy}
            onSave={(value) => void runtimes.setCap(runtime, value)}
          />
          {!builtIn && (
            <>
              <ConfirmDialog
                trigger={<KeyRound className="size-3.5" />}
                triggerLabel={`Rotate the token of ${runtime.name}`}
                title={`Rotate the token of ${runtime.name}?`}
                description="The connected agent is disconnected immediately and needs the new token to come back."
                confirmLabel="Rotate"
                busy={busy}
                onConfirm={() => void runtimes.rotate(runtime)}
              />
              <ConfirmDialog
                trigger={<Trash2 className="size-3.5" />}
                triggerLabel={`Delete ${runtime.name}`}
                title={`Delete ${runtime.name}?`}
                description="Refused while it still holds sandboxes or snapshots."
                confirmLabel="Delete"
                destructive
                busy={busy}
                onConfirm={() => void runtimes.remove(runtime)}
              />
            </>
          )}
        </div>
      )}
    </li>
  );
}
