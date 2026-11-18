import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { CreateMachineSizeDialog } from "@/modules/machine-sizes/components/create-machine-size-dialog.tsx";
import { MachineSizeRow } from "@/modules/machine-sizes/components/machine-size-row.tsx";
import { useMachineSizeAdmin } from "@/modules/machine-sizes/hooks/use-machine-size-admin.ts";

export function PresetsPanel({ admin }: { admin: boolean }) {
  const sizes = useMachineSizeAdmin();

  return (
    <Panel
      title="Presets"
      subtitle="The sizes a sandbox can be created with. The full list lives under Admin → Machine sizes."
      action={
        admin ? (
          <CreateMachineSizeDialog busy={sizes.busy === "create"} onCreate={sizes.create} />
        ) : null
      }
      flush
    >
      {sizes.poll.loading && !sizes.poll.data ? (
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          <Skeleton className="h-8 w-full rounded-lg" />
        </div>
      ) : (
        <ul role="list" className="divide-y divide-border/70">
          {sizes.active.map((size) => (
            <MachineSizeRow key={size.name} size={size} sizes={sizes} />
          ))}
        </ul>
      )}
    </Panel>
  );
}
