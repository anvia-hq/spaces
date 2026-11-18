import { DEFAULT_MACHINE_SIZE, type MachineSize } from "@spaces/shared/sandbox";
import { ConfirmDialog } from "@/components/console/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Trash2 } from "lucide-react";
import type { MachineSizes } from "../hooks/use-machine-size-admin.ts";

export function MachineSizeRow({ size, sizes }: { size: MachineSize; sizes: MachineSizes }) {
  const isDefault = size.name === DEFAULT_MACHINE_SIZE;
  const retired = size.retiredAt !== null;
  const busy = sizes.busy === `retire-${size.name}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5">
      <span className="min-w-0 truncate text-base font-medium text-foreground">{size.name}</span>
      {isDefault && <Badge variant="secondary">default</Badge>}
      {retired && <Badge variant="outline">retired</Badge>}
      <span className="min-w-0 basis-full break-words text-base text-muted-foreground sm:basis-auto">
        {size.vcpu} vCPU · {(size.memMib / 1024).toFixed(1)} GiB · {size.diskGb} GB disk
        {size.description && ` · ${size.description}`}
      </span>

      {!retired && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {isDefault ? (
            <Button size="sm" variant="ghost" disabled>
              Cannot retire
            </Button>
          ) : (
            <ConfirmDialog
              trigger={busy ? <Spinner className="size-3.5" /> : <Trash2 className="size-3.5" />}
              triggerLabel={`Retire ${size.name}`}
              title={`Retire ${size.name}?`}
              description="New sandboxes cannot use it; existing sandboxes and snapshots keep it and stay readable."
              confirmLabel="Retire"
              destructive
              busy={busy}
              onConfirm={() => void sizes.retire(size)}
            />
          )}
        </div>
      )}
    </li>
  );
}
