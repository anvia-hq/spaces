import { Ruler } from "lucide-react";
import { PageHeader, MetaLine } from "@/components/console/page-header";
import { Panel } from "@/components/console/panel";
import { Skeleton } from "@/components/console/skeleton";
import { CreateMachineSizeDialog } from "./create-machine-size-dialog.tsx";
import { MachineSizeRow } from "./machine-size-row.tsx";
import { useMachineSizeAdmin } from "../hooks/use-machine-size-admin.ts";

export function MachineSizesPage() {
  const sizes = useMachineSizeAdmin(true);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Machine sizes"
        icon={<Ruler />}
        actions={
          <>
            <MetaLine items={[sizes.poll.loading ? "loading" : `${sizes.active.length} active`]} />
            <CreateMachineSizeDialog busy={sizes.busy === "create"} onCreate={sizes.create} />
          </>
        }
      />

      <Panel
        title="Presets"
        subtitle="What a sandbox is created with. Retiring keeps every existing sandbox readable and reusable."
        flush
      >
        {sizes.poll.loading && !sizes.poll.data ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-lg" />
          </div>
        ) : (
          <ul role="list" className="divide-y divide-border/70">
            {sizes.sizes.map((size) => (
              <MachineSizeRow key={size.name} size={size} sizes={sizes} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
