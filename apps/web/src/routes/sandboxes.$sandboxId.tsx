import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { Tabs } from "@/components/console/tabs";
import { Button } from "@/components/ui/button";
import { DetailSkeleton } from "@/modules/sandboxes/components/detail-skeleton.tsx";
import { Lifecycle } from "@/modules/sandboxes/components/lifecycle.tsx";
import { MachinePanel } from "@/modules/sandboxes/components/machine-panel.tsx";
import { SandboxHeader } from "@/modules/sandboxes/components/sandbox-header.tsx";
import { useSandbox } from "@/modules/sandboxes/hooks/use-sandbox.ts";
import type { SandboxTab } from "@/modules/sandboxes/types.ts";
import { FilesPanel } from "@/modules/files/components/files-panel.tsx";
import { PortsPanel } from "@/modules/ports/components/ports-panel.tsx";
import { SnapshotsPanel } from "@/modules/snapshots/components/snapshots-panel.tsx";
import { SshPanel } from "@/modules/ssh/components/ssh-panel.tsx";
import { TerminalPanel } from "@/modules/terminal/components/terminal-panel.tsx";
import { UsagePanel } from "@/modules/usage/components/usage-panel.tsx";
import { LIVE_STATES } from "@/lib/api.ts";

export const Route = createFileRoute("/sandboxes/$sandboxId")({
  component: SandboxDetail,
});

const TABS: readonly { value: SandboxTab; label: string }[] = [
  { value: "terminal", label: "Terminal" },
  { value: "files", label: "Files" },
  { value: "ports", label: "Ports" },
  { value: "ssh", label: "SSH" },
  { value: "snapshots", label: "Snapshots" },
  { value: "usage", label: "Usage" },
];

function SandboxDetail() {
  const { sandboxId } = Route.useParams();
  const { poll, sandbox, busy, act, remove } = useSandbox(sandboxId);
  const [tab, setTab] = useState<SandboxTab>("terminal");
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (poll.error && !sandbox) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <h1 className="text-base font-semibold tracking-heading text-foreground">
          Sandbox not reachable
        </h1>
        <p className="mt-2 text-base leading-relaxed text-muted-foreground">{poll.error}</p>
        <Button
          className="mt-6"
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/" />}
        >
          <ChevronLeft />
          All sandboxes
        </Button>
      </div>
    );
  }

  if (!sandbox) return <DetailSkeleton />;

  const live = LIVE_STATES.includes(sandbox.state);

  return (
    <div className="flex flex-col gap-6">
      <SandboxHeader
        sandbox={sandbox}
        busy={busy}
        stale={poll.stale && !poll.error}
        act={act}
        onDelete={() => void remove()}
        deleteOpen={deleteOpen}
        onDeleteOpenChange={setDeleteOpen}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_296px]">
        <div className="min-w-0">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <div className="pt-4">
            {tab === "terminal" && <TerminalPanel sandboxId={sandboxId} live={live} />}
            {tab === "files" && <FilesPanel sandboxId={sandboxId} live={live} />}
            {tab === "ports" && <PortsPanel sandboxId={sandboxId} live={live} />}
            {tab === "ssh" && <SshPanel sandboxId={sandboxId} live={live} />}
            {tab === "snapshots" && <SnapshotsPanel sandboxId={sandboxId} live={live} />}
            {tab === "usage" && <UsagePanel sandboxId={sandboxId} />}
          </div>
        </div>

        <aside className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-[104px] xl:self-start">
          <MachinePanel sandbox={sandbox} />
          <Lifecycle sandboxId={sandboxId} createdAt={sandbox.createdAt} />
        </aside>
      </div>
    </div>
  );
}
