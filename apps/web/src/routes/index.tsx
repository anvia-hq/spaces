import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Plus, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/console/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/reui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CreateSandboxDialog } from "@/modules/sandboxes/components/create-sandbox-dialog.tsx";
import { EmptyFleet } from "@/modules/sandboxes/components/empty-fleet.tsx";
import { GridSkeleton } from "@/modules/sandboxes/components/grid-skeleton.tsx";
import { SandboxGrid } from "@/modules/sandboxes/components/sandbox-grid.tsx";
import { useMachineSizes } from "@/modules/sandboxes/hooks/use-machine-sizes.ts";
import { useSandboxes } from "@/modules/sandboxes/hooks/use-sandboxes.ts";

export const Route = createFileRoute("/")({
  component: SandboxesPage,
});

function SandboxesPage() {
  const { poll, rows, busy, act, create } = useSandboxes();
  const { sizes, byName } = useMachineSizes();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sandboxes"
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void poll.refresh()}
              disabled={busy === "refresh"}
            >
              <RefreshCw className={cn(poll.stale && "text-warning")} />
              Refresh
            </Button>
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus />
              Create Sandbox
            </Button>
          </>
        }
      />

      <CreateSandboxDialog
        open={creating}
        onOpenChange={setCreating}
        sizes={sizes}
        busy={busy === "create"}
        onCreate={create}
      />

      {poll.error && !poll.data && (
        <Alert variant="destructive">
          <AlertTitle>The API did not answer</AlertTitle>
          <AlertDescription>{poll.error}</AlertDescription>
        </Alert>
      )}

      {poll.loading && !poll.data && <GridSkeleton />}

      {poll.data && rows.length === 0 && <EmptyFleet />}

      {rows.length > 0 && (
        <SandboxGrid rows={rows} sizes={(name) => byName.get(name)} busy={busy} act={act} />
      )}
    </div>
  );
}
